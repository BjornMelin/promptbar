use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use ignore::WalkBuilder;
use serde_json::{Value, json};

use crate::db::{DocumentInput, Store, content_extension, now_iso, sha256, stable_id};
use crate::error::{IoContext, Result};
use crate::models::ImportReport;
use crate::redact;

const ROOT_LANES: &[&str] = &[
    "canon",
    "sources",
    "references",
    "projects",
    "archive",
    "manifests",
    "tools",
];

pub fn import_corpus(store: &Store, root: &Path) -> Result<ImportReport> {
    let at = now_iso();
    if !root.exists() {
        let report = ImportReport {
            root: root.display().to_string(),
            imported: 0,
            skipped: 0,
            raw_records: 0,
            files: 0,
            at,
        };
        store.record_import(&report)?;
        store.append_audit("import_corpus", serde_json::to_value(&report)?)?;
        return Ok(report);
    }

    let root = root.canonicalize().at_path(root)?;
    let files = discover_files(&root)?;
    let mut imported = 0;
    let mut skipped = 0;
    let mut raw_records = 0;

    for relative in &files {
        let absolute = root.join(relative);
        if !content_extension(&absolute) {
            skipped += 1;
            continue;
        }
        if relative.to_string_lossy().contains("raw-prompts")
            && absolute.extension().and_then(|ext| ext.to_str()) == Some("jsonl")
        {
            let report = import_raw_jsonl(store, &root, relative, &absolute, &at)?;
            imported += report.imported;
            skipped += report.skipped;
            raw_records += report.raw_records;
            continue;
        }
        let content = read_text(&absolute)?;
        if content.trim().is_empty() {
            skipped += 1;
            continue;
        }
        import_document(
            store,
            DocumentSeed {
                root: &root,
                relative,
                content: &content,
                at: &at,
                source_record_id: None,
                source_type: "file",
                extra_tags: Vec::new(),
                risk_flags: redact::merge_risk_flags(&content, &[]),
                raw_metadata: json!({}),
            },
        )?;
        imported += 1;
    }

    let report = ImportReport {
        root: root.display().to_string(),
        imported,
        skipped,
        raw_records,
        files: files.len(),
        at,
    };
    store.record_import(&report)?;
    store.append_audit("import_corpus", serde_json::to_value(&report)?)?;
    Ok(report)
}

struct RawReport {
    imported: usize,
    skipped: usize,
    raw_records: usize,
}

struct DocumentSeed<'a> {
    root: &'a Path,
    relative: &'a Path,
    content: &'a str,
    at: &'a str,
    source_record_id: Option<String>,
    source_type: &'a str,
    extra_tags: Vec<String>,
    risk_flags: Vec<String>,
    raw_metadata: Value,
}

fn discover_files(root: &Path) -> Result<Vec<PathBuf>> {
    let git_files = discover_git_files(root);
    let mut files = if let Some(files) = git_files {
        files
    } else {
        WalkBuilder::new(root)
            .hidden(false)
            .git_ignore(true)
            .git_global(true)
            .git_exclude(true)
            .build()
            .filter_map(std::result::Result::ok)
            .filter(|entry| entry.file_type().is_some_and(|ty| ty.is_file()))
            .filter_map(|entry| entry.path().strip_prefix(root).ok().map(PathBuf::from))
            .collect()
    };
    files.retain(|path| allowed_path(path));
    files.sort();
    Ok(files)
}

fn discover_git_files(root: &Path) -> Option<Vec<PathBuf>> {
    if !root.join(".git").exists() {
        return None;
    }
    let output = Command::new("git")
        .args(["ls-files", "--cached", "--others", "--exclude-standard"])
        .current_dir(root)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    Some(
        stdout
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(PathBuf::from)
            .collect(),
    )
}

fn allowed_path(relative: &Path) -> bool {
    let first = relative
        .components()
        .next()
        .and_then(|part| part.as_os_str().to_str());
    if !first.is_some_and(|lane| ROOT_LANES.contains(&lane)) {
        return false;
    }
    if relative.starts_with("generated")
        || relative
            .components()
            .any(|component| component.as_os_str() == "dogfood-output")
    {
        return false;
    }
    content_extension(relative)
}

fn import_raw_jsonl(
    store: &Store,
    root: &Path,
    relative: &Path,
    absolute: &Path,
    at: &str,
) -> Result<RawReport> {
    let mut imported = 0;
    let mut skipped = 0;
    let mut raw_records = 0;
    for line in read_text(absolute)?.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            skipped += 1;
            continue;
        };
        let content = record
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if content.trim().is_empty() {
            skipped += 1;
            continue;
        }
        raw_records += 1;
        let record_id = record
            .get("record_id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| {
                stable_id(["raw", &relative.display().to_string(), &sha256(&content)])
            });
        let tags = normalize_json_string_list(record.get("tags"));
        let risk_flags = redact::merge_risk_flags(
            &content,
            &normalize_json_string_list(record.get("risk_flags")),
        );
        import_document(
            store,
            DocumentSeed {
                root,
                relative,
                content: &content,
                at,
                source_record_id: Some(record_id),
                source_type: "codex-jsonl",
                extra_tags: tags,
                risk_flags,
                raw_metadata: record,
            },
        )?;
        imported += 1;
    }
    Ok(RawReport {
        imported,
        skipped,
        raw_records,
    })
}

fn import_document(store: &Store, seed: DocumentSeed<'_>) -> Result<()> {
    let relative_string = seed.relative.display().to_string();
    let kind = kind_for_path(seed.relative, seed.source_type);
    let title = title_for_content(seed.content, seed.relative);
    let content_hash = sha256(seed.content);
    let root_string = seed.root.display().to_string();
    let id = stable_id([
        "doc",
        &root_string,
        &relative_string,
        seed.source_record_id.as_deref().unwrap_or(""),
    ]);
    let tags = merge_lists(
        merge_lists(tags_for_path(seed.relative), intent_tags(seed.content)),
        seed.extra_tags,
    );
    store.upsert_document(DocumentInput {
        id: id.clone(),
        title: title.clone(),
        kind: kind.to_string(),
        status: "inbox".to_string(),
        favorite: false,
        tags,
        risk_flags: seed.risk_flags,
        source_type: seed.source_type.to_string(),
        source_path: seed.root.join(seed.relative).display().to_string(),
        source_record_id: seed.source_record_id,
        corpus_root: Some(seed.root.display().to_string()),
        corpus_path: format!("{kind}/{id}.md"),
        content: seed.content.to_string(),
        imported_at: seed.at.to_string(),
        frontmatter: json!({
            "id": id,
            "title": title,
            "kind": kind,
            "sourcePath": relative_string,
            "sourceType": seed.source_type,
            "importedAt": seed.at,
            "contentHash": content_hash,
            "metadata": seed.raw_metadata.get("metadata").cloned().unwrap_or_else(|| json!({})),
        }),
    })
}

fn read_text(path: &Path) -> Result<String> {
    let stat = fs::metadata(path).at_path(path)?;
    if stat.len() > 4 * 1024 * 1024 {
        return Ok(String::new());
    }
    fs::read_to_string(path).at_path(path)
}

fn kind_for_path(relative: &Path, source_type: &str) -> &'static str {
    if source_type == "codex-jsonl" {
        return "codex-raw";
    }

    match relative
        .components()
        .next()
        .and_then(|component| component.as_os_str().to_str())
    {
        Some("canon") => "canon",
        Some("references") => "reference",
        Some("projects") => "project",
        Some("archive") => "archive",
        Some("manifests") => "manifest",
        _ => "imported",
    }
}

fn title_for_content(content: &str, relative: &Path) -> String {
    content
        .lines()
        .find_map(|line| line.strip_prefix("# ").map(str::trim))
        .filter(|title| !title.is_empty())
        .map(|title| title.chars().take(140).collect())
        .unwrap_or_else(|| {
            relative
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("prompt")
                .replace(['_', '-'], " ")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(140)
                .collect()
        })
}

fn tags_for_path(relative: &Path) -> Vec<String> {
    relative
        .iter()
        .filter_map(|part| part.to_str())
        .flat_map(|part| part.split(['.', '_', '-']))
        .filter(|part| part.len() > 2 && !part.chars().all(|ch| ch.is_ascii_digit()))
        .take(8)
        .map(normalize_tag)
        .filter(|part| !part.is_empty())
        .collect()
}

fn intent_tags(content: &str) -> Vec<String> {
    let lower = content.to_lowercase();
    [
        ("ui", ["ui", "ux", "frontend", "design"].as_slice()),
        (
            "research",
            ["research", "docs", "source", "evidence"].as_slice(),
        ),
        ("review", ["review", "audit", "risk", "finding"].as_slice()),
        (
            "debug",
            ["debug", "triage", "root cause", "failure"].as_slice(),
        ),
        ("deploy", ["deploy", "release", "ci", "vercel"].as_slice()),
        ("python", ["python", "pytest", "ruff", "uv "].as_slice()),
        (
            "typescript",
            ["typescript", "react", "next.js", "bun"].as_slice(),
        ),
        ("security", ["security", "secret", "token"].as_slice()),
    ]
    .iter()
    .filter(|(_, needles)| needles.iter().any(|needle| lower.contains(needle)))
    .map(|(tag, _)| (*tag).to_string())
    .collect()
}

fn normalize_json_string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(normalize_tag)
                .filter(|tag| !tag.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn normalize_tag(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-')
        .collect()
}

fn merge_lists(mut left: Vec<String>, right: Vec<String>) -> Vec<String> {
    left.extend(right);
    left.sort();
    left.dedup();
    left
}

#[cfg(test)]
mod tests {
    use super::{allowed_path, kind_for_path};
    use std::path::Path;

    #[test]
    fn classifies_import_lanes_by_path_component() {
        for (lane, expected) in [
            ("canon", "canon"),
            ("references", "reference"),
            ("projects", "project"),
            ("archive", "archive"),
            ("manifests", "manifest"),
            ("tools", "imported"),
        ] {
            let relative = Path::new(lane).join("prompt.md");
            assert_eq!(kind_for_path(&relative, "markdown"), expected);
        }
        assert_eq!(
            kind_for_path(Path::new("canon/prompt.md"), "codex-jsonl"),
            "codex-raw"
        );
    }

    #[test]
    fn excludes_dogfood_output_by_path_component() {
        assert!(allowed_path(&Path::new("canon").join("prompt.md")));
        assert!(!allowed_path(
            &Path::new("canon").join("dogfood-output").join("prompt.md")
        ));
    }
}
