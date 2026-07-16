use std::io::{self, Read};
use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::{CommandFactory, Parser, Subcommand, ValueEnum};
use clap_complete::Shell;
use promptops_core::StatePaths;
use promptops_core::capture;
use promptops_core::db::Store;
use promptops_core::embed;
use promptops_core::ingest;
use promptops_core::models::{
    EmbedConfig, Output, PatchPrompt, SaveEvalRun, SearchMode as CoreSearchMode, SearchRequest,
};

#[derive(Debug, Parser)]
#[command(
    name = "promptops",
    version,
    about = "Local-first prompt capture, indexing, search, and curation"
)]
struct Cli {
    #[arg(long, global = true, help = "Emit stable machine-readable JSON")]
    json: bool,
    #[arg(long, global = true, env = "PROMPTOPS_STATE_DIR")]
    state_dir: Option<PathBuf>,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    Doctor,
    Init,
    Capture {
        #[command(subcommand)]
        command: CaptureCommand,
    },
    Import {
        #[arg(value_name = "ROOT")]
        root: PathBuf,
    },
    Search {
        #[arg(default_value = "")]
        query: String,
        #[arg(long, value_enum, default_value_t = SearchMode::Lexical)]
        mode: SearchMode,
        #[arg(long)]
        kind: Option<String>,
        #[arg(long)]
        status: Option<String>,
        #[arg(long)]
        tag: Option<String>,
        #[arg(long)]
        risk: Option<String>,
        #[arg(long, default_value_t = 30)]
        limit: usize,
    },
    Show {
        id: String,
        #[arg(long)]
        raw: bool,
    },
    Overlay {
        #[command(subcommand)]
        command: OverlayCommand,
    },
    Eval {
        #[command(subcommand)]
        command: EvalCommand,
    },
    Export {
        #[arg(long)]
        out: PathBuf,
        #[arg(long)]
        raw: bool,
        ids: Vec<String>,
    },
    Embed {
        #[command(subcommand)]
        command: EmbedCommand,
    },
    Policy {
        #[command(subcommand)]
        command: PolicyCommand,
    },
    Completions {
        shell: Shell,
    },
    Manpage,
}

#[derive(Debug, Subcommand)]
enum CaptureCommand {
    Hook,
    Backfill {
        #[arg(long)]
        since_hours: Option<i64>,
        #[arg(long)]
        since_days: Option<f64>,
        #[arg(long)]
        limit_files: Option<usize>,
        #[arg(long)]
        dry_run: bool,
    },
}

#[derive(Debug, Subcommand)]
enum OverlayCommand {
    Patch {
        id: String,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        content: Option<String>,
        #[arg(long, conflicts_with = "content")]
        content_stdin: bool,
        #[arg(long)]
        status: Option<String>,
        #[arg(long)]
        favorite: Option<bool>,
        #[arg(long, value_delimiter = ',')]
        tags: Option<Vec<String>>,
        #[arg(long)]
        reason: Option<String>,
    },
}

#[derive(Debug, Subcommand)]
enum EvalCommand {
    Save {
        #[arg(long)]
        id: String,
        #[arg(long)]
        created_at: String,
        #[arg(long)]
        mode: String,
        #[arg(long)]
        model: String,
    },
}

#[derive(Debug, Subcommand)]
enum EmbedCommand {
    Status,
    Rebuild {
        #[arg(
            long,
            env = "PROMPTOPS_EMBED_BASE_URL",
            default_value = "https://api.openai.com/v1"
        )]
        base_url: String,
        #[arg(
            long,
            env = "PROMPTOPS_EMBED_MODEL",
            default_value = "text-embedding-3-small"
        )]
        model: String,
        #[arg(long, env = "PROMPTOPS_EMBED_API_KEY")]
        api_key: Option<String>,
        #[arg(long)]
        dimensions: Option<usize>,
        #[arg(long, default_value_t = 128)]
        limit: usize,
    },
    Probe {
        #[arg(
            long,
            env = "PROMPTOPS_EMBED_BASE_URL",
            default_value = "https://api.openai.com/v1"
        )]
        base_url: String,
    },
}

#[derive(Debug, Subcommand)]
enum PolicyCommand {
    Manifest,
    Explain,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum SearchMode {
    Lexical,
    Hybrid,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match run(cli).await {
        Ok(()) => Ok(()),
        Err(error) => {
            eprintln!("promptops: {error:#}");
            Err(error)
        }
    }
}

async fn run(cli: Cli) -> Result<()> {
    match cli.command {
        Commands::Completions { shell } => {
            let mut command = Cli::command();
            clap_complete::generate(shell, &mut command, "promptops", &mut io::stdout());
            Ok(())
        }
        Commands::Manpage => {
            let command = Cli::command();
            let man = clap_mangen::Man::new(command);
            man.render(&mut io::stdout())?;
            Ok(())
        }
        command => {
            let paths = StatePaths::resolve_with_state_dir(cli.state_dir.clone())?;
            let store = Store::open(paths)?;
            match command {
                Commands::Doctor => emit(cli.json, store.doctor()?),
                Commands::Init => emit(cli.json, store.doctor()?),
                Commands::Capture { command } => match command {
                    CaptureCommand::Hook => {
                        let stats = capture::capture_hook(&store).or_else(|error| {
                            let _ = store.append_audit(
                                "hook_error",
                                serde_json::json!({"error": error.to_string()}),
                            );
                            eprintln!("promptops hook failed locally; work continues: {error}");
                            Ok::<_, promptops_core::PromptOpsError>(
                                promptops_core::models::CaptureStats {
                                    files: 0,
                                    records: 0,
                                    inserted: 0,
                                    skipped: 1,
                                },
                            )
                        })?;
                        if cli.json {
                            emit(true, stats)?;
                        }
                        Ok(())
                    }
                    CaptureCommand::Backfill {
                        since_hours,
                        since_days,
                        limit_files,
                        dry_run,
                    } => {
                        let since = if let Some(hours) = since_hours {
                            chrono::Utc::now() - chrono::Duration::hours(hours)
                        } else {
                            let days = since_days.unwrap_or(7.0);
                            chrono::Utc::now() - chrono::Duration::seconds((days * 86_400.0) as i64)
                        };
                        emit(
                            cli.json,
                            capture::backfill(&store, since, limit_files, dry_run)?,
                        )
                    }
                },
                Commands::Import { root } => emit(cli.json, ingest::import_corpus(&store, &root)?),
                Commands::Search {
                    query,
                    mode,
                    kind,
                    status,
                    tag,
                    risk,
                    limit,
                } => {
                    let request = SearchRequest {
                        query,
                        mode: match mode {
                            SearchMode::Lexical => CoreSearchMode::Lexical,
                            SearchMode::Hybrid => CoreSearchMode::Hybrid,
                        },
                        kind,
                        status,
                        tag,
                        risk,
                        limit,
                    };
                    if matches!(mode, SearchMode::Hybrid) {
                        let config = search_embed_config();
                        emit(
                            cli.json,
                            embed::hybrid_search(&store, request, config.as_ref()).await?,
                        )
                    } else {
                        emit(cli.json, store.search(request)?)
                    }
                }
                Commands::Show { id, raw } => {
                    let prompt = store
                        .get_prompt(&id)?
                        .with_context(|| format!("prompt {id} was not found"))?;
                    if cli.json {
                        let mut prompt = prompt;
                        if !raw {
                            prompt.content = prompt.redacted_content.clone();
                        }
                        emit(true, prompt)
                    } else {
                        println!("# {}", prompt.summary.title);
                        println!();
                        println!(
                            "{}",
                            if raw {
                                prompt.content
                            } else {
                                prompt.redacted_content
                            }
                        );
                        Ok(())
                    }
                }
                Commands::Overlay { command } => match command {
                    OverlayCommand::Patch {
                        id,
                        title,
                        content,
                        content_stdin,
                        status,
                        favorite,
                        tags,
                        reason,
                    } => {
                        let content = if content_stdin {
                            let mut content = String::new();
                            io::stdin().read_to_string(&mut content).context(
                                "overlay patch --content-stdin expects content on stdin",
                            )?;
                            Some(content)
                        } else {
                            content
                        };
                        let prompt = store
                            .patch_prompt(
                                &id,
                                PatchPrompt {
                                    title,
                                    content,
                                    status,
                                    favorite,
                                    tags,
                                    reason,
                                },
                            )?
                            .with_context(|| format!("prompt {id} was not found"))?;
                        emit(cli.json, prompt)
                    }
                },
                Commands::Eval { command } => match command {
                    EvalCommand::Save {
                        id,
                        created_at,
                        mode,
                        model,
                    } => {
                        let mut payload = String::new();
                        io::stdin().read_to_string(&mut payload)?;
                        let payload: serde_json::Value = serde_json::from_str(&payload)
                            .context("eval save expects a JSON payload on stdin")?;
                        emit(
                            cli.json,
                            store.save_eval_run(SaveEvalRun {
                                id,
                                created_at,
                                mode,
                                model,
                                payload,
                            })?,
                        )
                    }
                },
                Commands::Export { out, raw, ids } => {
                    emit(cli.json, store.export_prompts(&ids, &out, raw)?)
                }
                Commands::Embed { command } => match command {
                    EmbedCommand::Status => emit(cli.json, store.embed_status()?),
                    EmbedCommand::Rebuild {
                        base_url,
                        model,
                        api_key,
                        dimensions,
                        limit,
                    } => {
                        let config = EmbedConfig {
                            base_url,
                            api_key,
                            model,
                            dimensions,
                        };
                        emit(
                            cli.json,
                            embed::rebuild_embeddings(&store, &config, limit).await?,
                        )
                    }
                    EmbedCommand::Probe { base_url } => emit(
                        cli.json,
                        serde_json::json!({
                            "baseUrl": base_url,
                            "manualProfileRequired": true,
                            "embeddingsEndpoint": format!("{}/embeddings", base_url.trim_end_matches('/')),
                        }),
                    ),
                },
                Commands::Policy { command } => match command {
                    PolicyCommand::Manifest => emit(cli.json, policy_manifest()),
                    PolicyCommand::Explain => emit(cli.json, policy_explain()),
                },
                Commands::Completions { .. } | Commands::Manpage => unreachable!(),
            }
        }
    }
}

fn emit<T>(json: bool, data: T) -> Result<()>
where
    T: serde::Serialize,
{
    if json {
        println!("{}", serde_json::to_string_pretty(&Output::new(data))?);
    } else {
        println!("{}", serde_json::to_string_pretty(&data)?);
    }
    Ok(())
}

fn policy_manifest() -> serde_json::Value {
    serde_json::json!({
        "schema": "promptops.policy-manifest.v1",
        "gates": [
            "cargo fmt --all --check",
            "cargo clippy --workspace --all-targets --all-features --locked -- -D warnings",
            "cargo test --workspace --all-targets --all-features --locked",
            "cargo run -q -p promptops-cli -- --json doctor",
            "bun run lint",
            "bun run typecheck",
            "bun run test",
            "bun run build",
            "bun run test:e2e"
        ]
    })
}

fn policy_explain() -> serde_json::Value {
    serde_json::json!({
        "schema": "promptops.policy-explain.v1",
        "summary": "promptops is local-first: hooks must fail open, raw captures stay in private global state, repo writes are explicit exports, and Promptbar must not own a second search/index database."
    })
}

fn search_embed_config() -> Option<EmbedConfig> {
    let base_url = non_empty_env("PROMPTOPS_EMBED_BASE_URL");
    let api_key = non_empty_env("PROMPTOPS_EMBED_API_KEY");
    if base_url.is_none() && api_key.is_none() {
        return None;
    }
    Some(EmbedConfig {
        base_url: base_url.unwrap_or_else(|| "https://api.openai.com/v1".to_string()),
        api_key,
        model: non_empty_env("PROMPTOPS_EMBED_MODEL")
            .unwrap_or_else(|| "text-embedding-3-small".to_string()),
        dimensions: non_empty_env("PROMPTOPS_EMBED_DIMENSIONS")
            .and_then(|value| value.parse().ok()),
    })
}

fn non_empty_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
