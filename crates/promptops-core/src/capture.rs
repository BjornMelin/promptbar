use std::env;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, Utc};
use serde_json::{Value, json};

use crate::db::{EventInput, Store, now_iso, sha256, stable_id};
use crate::error::{IoContext, Result};
use crate::models::CaptureStats;

const STDIN_CAP: usize = 1024 * 1024;

pub fn capture_hook(store: &Store) -> Result<CaptureStats> {
    let Some(payload) = read_stdin_payload()? else {
        return Ok(CaptureStats {
            files: 0,
            records: 0,
            inserted: 0,
            skipped: 0,
        });
    };
    let event = payload
        .get("hook_event_name")
        .and_then(Value::as_str)
        .unwrap_or("");
    match event {
        "UserPromptSubmit" => capture_user_prompt(store, &payload),
        "SessionStart" => {
            let hours = env::var("CODEX_PROMPT_LOG_CATCHUP_HOURS")
                .ok()
                .and_then(|value| value.parse::<i64>().ok())
                .unwrap_or(48);
            let limit_files = env::var("CODEX_PROMPT_LOG_CATCHUP_LIMIT_FILES")
                .ok()
                .and_then(|value| value.parse::<usize>().ok())
                .or(Some(80));
            backfill(
                store,
                Utc::now() - Duration::hours(hours),
                limit_files,
                false,
            )
        }
        _ => Ok(CaptureStats {
            files: 0,
            records: 0,
            inserted: 0,
            skipped: 1,
        }),
    }
}

pub fn backfill(
    store: &Store,
    since: DateTime<Utc>,
    limit_files: Option<usize>,
    dry_run: bool,
) -> Result<CaptureStats> {
    let mut stats = CaptureStats {
        files: 0,
        records: 0,
        inserted: 0,
        skipped: 0,
    };
    let files = session_files(since)?;
    for path in files.into_iter().take(limit_files.unwrap_or(usize::MAX)) {
        stats.files += 1;
        let records = parse_session_file(&path)?;
        stats.records += records.len();
        if dry_run {
            stats.inserted += records.len();
        } else {
            let (inserted, skipped) = store.insert_events(records)?;
            stats.inserted += inserted;
            stats.skipped += skipped;
        }
    }
    store.append_audit("backfill", serde_json::to_value(&stats)?)?;
    Ok(stats)
}

fn capture_user_prompt(store: &Store, payload: &Value) -> Result<CaptureStats> {
    let prompt = payload.get("prompt").and_then(Value::as_str).unwrap_or("");
    if prompt.trim().is_empty() {
        return Ok(CaptureStats {
            files: 0,
            records: 0,
            inserted: 0,
            skipped: 1,
        });
    }
    let event = event_from_parts(
        "user_prompt",
        "codex_hook",
        prompt,
        payload.get("session_id").and_then(Value::as_str),
        payload.get("turn_id").and_then(Value::as_str),
        None,
        payload.get("cwd").and_then(Value::as_str),
        payload.get("model").and_then(Value::as_str),
        payload.get("transcript_path").and_then(Value::as_str),
        now_iso(),
        json!({}),
    );
    let inserted = store.insert_event(event)?;
    Ok(CaptureStats {
        files: 0,
        records: 1,
        inserted: usize::from(inserted),
        skipped: usize::from(!inserted),
    })
}

fn read_stdin_payload() -> Result<Option<Value>> {
    let mut raw = String::new();
    io::stdin()
        .take((STDIN_CAP + 1) as u64)
        .read_to_string(&mut raw)
        .map_err(|err| {
            crate::PromptOpsError::InvalidInput(format!("failed to read stdin: {err}"))
        })?;
    if raw.len() > STDIN_CAP || raw.trim().is_empty() {
        return Ok(None);
    }
    let value = serde_json::from_str::<Value>(&raw)?;
    Ok(value.as_object().is_some().then_some(value))
}

fn session_files(since: DateTime<Utc>) -> Result<Vec<PathBuf>> {
    let cutoff = since.timestamp();
    let mut homes = vec![
        PathBuf::from(expand_home("~/.codex")),
        PathBuf::from(expand_home("~/.codex-app")),
    ];
    if let Some(home) = env::var_os("CODEX_HOME") {
        homes.insert(0, PathBuf::from(home));
    }
    let mut files = Vec::new();
    for home in homes {
        for root_name in ["sessions", "archived_sessions"] {
            let root = home.join(root_name);
            if !root.exists() {
                continue;
            }
            collect_jsonl_since(&root, cutoff, &mut files)?;
        }
    }
    files.sort();
    files.dedup();
    Ok(files)
}

fn collect_jsonl_since(root: &Path, cutoff: i64, out: &mut Vec<PathBuf>) -> Result<()> {
    for entry in fs::read_dir(root).at_path(root)? {
        let entry = entry.at_path(root)?;
        let path = entry.path();
        let file_type = entry.file_type().at_path(&path)?;
        if file_type.is_dir() {
            collect_jsonl_since(&path, cutoff, out)?;
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
            let modified = entry.metadata().at_path(&path)?.modified().at_path(&path)?;
            let modified = DateTime::<Utc>::from(modified).timestamp();
            if modified >= cutoff {
                out.push(path);
            }
        }
    }
    Ok(())
}

fn parse_session_file(path: &Path) -> Result<Vec<EventInput>> {
    let text = fs::read_to_string(path).at_path(path)?;
    let mut records = Vec::new();
    let mut session_id: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut model: Option<String> = None;
    let mut turn_id: Option<String> = None;
    let mut pending_decisions: std::collections::HashMap<String, Value> =
        std::collections::HashMap::new();

    for line in text.lines() {
        let Ok(obj) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let payload = obj.get("payload").cloned().unwrap_or_else(|| json!({}));
        let timestamp = obj
            .get("timestamp")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(now_iso);
        match obj.get("type").and_then(Value::as_str) {
            Some("session_meta") => {
                session_id = payload
                    .get("id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
                cwd = payload
                    .get("cwd")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
            }
            Some("turn_context") => {
                cwd = payload
                    .get("cwd")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
                    .or(cwd);
                model = payload
                    .get("model")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
                turn_id = payload
                    .get("turn_id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
            }
            Some("response_item") => {
                parse_response_item(
                    path,
                    &payload,
                    &timestamp,
                    session_id.as_deref(),
                    turn_id.as_deref(),
                    cwd.as_deref(),
                    model.as_deref(),
                    &mut pending_decisions,
                    &mut records,
                );
            }
            _ => {}
        }
    }
    Ok(records)
}

#[allow(clippy::too_many_arguments)]
fn parse_response_item(
    path: &Path,
    payload: &Value,
    timestamp: &str,
    session_id: Option<&str>,
    turn_id: Option<&str>,
    cwd: Option<&str>,
    model: Option<&str>,
    pending_decisions: &mut std::collections::HashMap<String, Value>,
    records: &mut Vec<EventInput>,
) {
    match payload.get("type").and_then(Value::as_str) {
        Some("message") => {
            let role = payload.get("role").and_then(Value::as_str).unwrap_or("");
            let text = message_content_text(payload);
            if text.trim().is_empty() {
                return;
            }
            if role == "user" && likely_runtime_context(&text) {
                return;
            }
            let kind = if role == "assistant" {
                "assistant_final"
            } else {
                "user_prompt"
            };
            records.push(event_from_parts(
                kind,
                "session_backfill",
                &text,
                session_id,
                turn_id,
                None,
                cwd,
                model,
                Some(&path.display().to_string()),
                timestamp.to_string(),
                json!({"role": role}),
            ));
        }
        Some("function_call") => {
            let name = payload.get("name").and_then(Value::as_str).unwrap_or("");
            let call_id = payload.get("call_id").and_then(Value::as_str);
            let args = parse_jsonish(payload.get("arguments"));
            match name {
                "spawn_agent" => {
                    let text = spawn_content(&args);
                    if !text.trim().is_empty() {
                        records.push(event_from_parts(
                            "subagent_spawn",
                            "session_backfill",
                            &text,
                            session_id,
                            turn_id,
                            call_id,
                            cwd,
                            model,
                            Some(&path.display().to_string()),
                            timestamp.to_string(),
                            json!({"agent_type": args.get("agent_type"), "fork_context": args.get("fork_context")}),
                        ));
                    }
                }
                "create_goal" => {
                    if let Some(objective) = args.get("objective").and_then(Value::as_str) {
                        records.push(event_from_parts(
                            "goal",
                            "session_backfill",
                            objective,
                            session_id,
                            turn_id,
                            call_id,
                            cwd,
                            model,
                            Some(&path.display().to_string()),
                            timestamp.to_string(),
                            json!({}),
                        ));
                    }
                }
                "request_user_input" => {
                    if let Some(call_id) = call_id {
                        pending_decisions.insert(call_id.to_string(), args);
                    }
                }
                _ => {}
            }
        }
        Some("function_call_output") => {
            let call_id = payload.get("call_id").and_then(Value::as_str).unwrap_or("");
            let output = parse_jsonish(payload.get("output"));
            if let Some(questions) = pending_decisions.remove(call_id) {
                if let Some(answers) = output.get("answers") {
                    let text = format!("Questions: {}\n\nAnswers: {}", questions, answers);
                    records.push(event_from_parts(
                        "decision",
                        "session_backfill",
                        &text,
                        session_id,
                        turn_id,
                        Some(call_id),
                        cwd,
                        model,
                        Some(&path.display().to_string()),
                        timestamp.to_string(),
                        json!({"questions": questions, "answers": answers}),
                    ));
                }
            } else if output.to_string().to_lowercase().contains("error") {
                records.push(event_from_parts(
                    "tool_error",
                    "session_backfill",
                    &output.to_string(),
                    session_id,
                    turn_id,
                    Some(call_id),
                    cwd,
                    model,
                    Some(&path.display().to_string()),
                    timestamp.to_string(),
                    json!({}),
                ));
            }
        }
        _ => {}
    }
}

#[allow(clippy::too_many_arguments)]
fn event_from_parts(
    kind: &str,
    source: &str,
    content: &str,
    session_id: Option<&str>,
    turn_id: Option<&str>,
    call_id: Option<&str>,
    cwd: Option<&str>,
    model: Option<&str>,
    transcript_path: Option<&str>,
    event_at: String,
    metadata: Value,
) -> EventInput {
    let tags = heuristic_tags(kind, content, cwd);
    EventInput {
        id: stable_id([
            "event",
            kind,
            session_id.unwrap_or(""),
            turn_id.unwrap_or(""),
            call_id.unwrap_or(""),
            &sha256(content),
        ]),
        kind: kind.to_string(),
        source: source.to_string(),
        session_id: session_id.map(ToOwned::to_owned),
        turn_id: turn_id.map(ToOwned::to_owned),
        call_id: call_id.map(ToOwned::to_owned),
        cwd: cwd.map(ToOwned::to_owned),
        model: model.map(ToOwned::to_owned),
        transcript_path: transcript_path.map(ToOwned::to_owned),
        event_at,
        content: content.to_string(),
        tags,
        metadata,
    }
}

fn message_content_text(payload: &Value) -> String {
    match payload.get("content") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| {
                let ty = item.get("type").and_then(Value::as_str)?;
                if matches!(ty, "input_text" | "output_text" | "text") {
                    item.get("text")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n\n"),
        _ => String::new(),
    }
}

fn parse_jsonish(value: Option<&Value>) -> Value {
    match value {
        Some(Value::Object(_)) => value.cloned().unwrap_or_else(|| json!({})),
        Some(Value::String(text)) => serde_json::from_str(text).unwrap_or_else(|_| json!({})),
        _ => json!({}),
    }
}

fn spawn_content(args: &Value) -> String {
    if let Some(message) = args.get("message").and_then(Value::as_str) {
        return message.to_string();
    }
    args.get("items")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n\n")
        })
        .unwrap_or_default()
}

fn likely_runtime_context(text: &str) -> bool {
    let stripped = text.trim_start();
    stripped.starts_with("# AGENTS.md instructions for ")
        || stripped.starts_with("<skill>")
        || stripped.starts_with("<subagent_notification>")
        || stripped.starts_with("Context from memory")
        || stripped.starts_with("========= MEMORY_")
}

fn heuristic_tags(kind: &str, content: &str, cwd: Option<&str>) -> Vec<String> {
    let lower = content.to_lowercase();
    let mut tags = vec!["codex".to_string(), format!("type:{kind}")];
    if let Some(cwd) = cwd
        .and_then(|cwd| Path::new(cwd).file_name())
        .and_then(|name| name.to_str())
    {
        tags.push(format!("repo:{}", safe_tag(cwd)));
    }
    for (name, needles) in [
        ("ui", ["ui", "frontend", "design"].as_slice()),
        ("research", ["research", "evidence", "source"].as_slice()),
        ("debug", ["debug", "error", "failure"].as_slice()),
        ("release", ["release", "verify", "ship"].as_slice()),
        ("security", ["secret", "token", "password"].as_slice()),
    ] {
        if needles.iter().any(|needle| lower.contains(needle)) {
            tags.push(format!("intent:{name}"));
        }
    }
    tags.sort();
    tags.dedup();
    tags
}

fn safe_tag(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn expand_home(value: &str) -> String {
    if let Some(rest) = value.strip_prefix("~/") {
        std::env::var("HOME")
            .map(|home| format!("{home}/{rest}"))
            .unwrap_or_else(|_| value.to_string())
    } else {
        value.to_string()
    }
}
