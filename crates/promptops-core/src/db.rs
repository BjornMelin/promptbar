use std::collections::HashMap;
use std::fs;
use std::path::Path;

use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, Row, params};
use rusqlite_migration::{M, Migrations};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::error::{IoContext, Result};
use crate::models::{
    CorpusStats, DoctorReport, EmbedStatus, ExportReport, FacetValue, Facets, ImportReport,
    PatchPrompt, PromptDetail, PromptSummary, PromptVersion, SaveEvalRun, SearchMode,
    SearchRequest, SearchResponse,
};
use crate::paths::StatePaths;
use crate::redact;

const CONTENT_EXTENSIONS: &[&str] = &["md", "mdx", "txt", "json", "jsonl", "yaml", "yml"];

#[derive(Debug, Clone)]
pub struct Store {
    paths: StatePaths,
}

#[derive(Debug, Clone)]
pub struct DocumentInput {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub status: String,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub risk_flags: Vec<String>,
    pub source_type: String,
    pub source_path: String,
    pub source_record_id: Option<String>,
    pub corpus_root: Option<String>,
    pub corpus_path: String,
    pub content: String,
    pub frontmatter: Value,
    pub imported_at: String,
}

#[derive(Debug, Clone)]
pub struct EventInput {
    pub id: String,
    pub kind: String,
    pub source: String,
    pub session_id: Option<String>,
    pub turn_id: Option<String>,
    pub call_id: Option<String>,
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub transcript_path: Option<String>,
    pub event_at: String,
    pub content: String,
    pub tags: Vec<String>,
    pub metadata: Value,
}

impl Store {
    pub fn open(paths: StatePaths) -> Result<Self> {
        paths.ensure_private_dirs()?;
        let store = Self { paths };
        store.migrate()?;
        Ok(store)
    }

    pub fn paths(&self) -> &StatePaths {
        &self.paths
    }

    pub fn connect(&self) -> Result<Connection> {
        let conn = Connection::open(&self.paths.db_path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(conn)
    }

    pub fn migrate(&self) -> Result<()> {
        let mut conn = self.connect()?;
        apply_migrations(&mut conn)?;
        Ok(())
    }

    pub fn doctor(&self) -> Result<DoctorReport> {
        let conn = self.connect()?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        Ok(DoctorReport {
            ok: version >= crate::models::DB_SCHEMA_VERSION,
            state_root: self.paths.state_root.display().to_string(),
            config_root: self.paths.config_root.display().to_string(),
            cache_root: self.paths.cache_root.display().to_string(),
            db_path: self.paths.db_path.display().to_string(),
            raw_dir: self.paths.raw_dir.display().to_string(),
            audit_log: self.paths.audit_log.display().to_string(),
            db_exists: self.paths.db_path.exists(),
            db_schema_version: version,
        })
    }

    pub fn append_audit(&self, event: &str, payload: Value) -> Result<()> {
        let record = json!({
            "at": now_iso(),
            "event": event,
            "payload": payload,
        });
        append_jsonl_private(&self.paths.audit_log, &record)
    }

    pub fn insert_event(&self, input: EventInput) -> Result<bool> {
        let conn = self.connect()?;
        insert_event_on_conn(&conn, input)
    }

    pub fn insert_events(&self, inputs: Vec<EventInput>) -> Result<(usize, usize)> {
        let mut conn = self.connect()?;
        let tx = conn.transaction()?;
        let mut inserted = 0;
        let mut skipped = 0;
        for input in inputs {
            if insert_event_on_conn(&tx, input)? {
                inserted += 1;
            } else {
                skipped += 1;
            }
        }
        tx.commit()?;
        Ok((inserted, skipped))
    }

    pub fn upsert_document(&self, input: DocumentInput) -> Result<()> {
        let mut conn = self.connect()?;
        let tx = conn.transaction()?;
        let redaction = redact::redact(&input.content);
        let risk_flags = merge_lists(input.risk_flags, redaction.risk_flags);
        let content_hash = sha256(&input.content);
        let excerpt = excerpt(&redaction.text);
        let updated_at = now_iso();
        tx.execute(
            r#"
            INSERT INTO documents(
                id, title, kind, status, favorite, tags_json, risk_flags_json,
                source_type, source_path, source_record_id, corpus_root, corpus_path,
                content_hash, content, redacted_content, excerpt, frontmatter_json,
                imported_at, updated_at
            )
            VALUES(
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                ?15, ?16, ?17, ?18, ?19
            )
            ON CONFLICT(id) DO UPDATE SET
                title=excluded.title,
                kind=excluded.kind,
                tags_json=excluded.tags_json,
                risk_flags_json=excluded.risk_flags_json,
                source_type=excluded.source_type,
                source_path=excluded.source_path,
                source_record_id=excluded.source_record_id,
                corpus_root=excluded.corpus_root,
                corpus_path=excluded.corpus_path,
                content_hash=excluded.content_hash,
                content=excluded.content,
                redacted_content=excluded.redacted_content,
                excerpt=excluded.excerpt,
                frontmatter_json=excluded.frontmatter_json,
                updated_at=excluded.updated_at
            "#,
            params![
                input.id,
                input.title,
                input.kind,
                input.status,
                bool_to_i64(input.favorite),
                to_json(&input.tags)?,
                to_json(&risk_flags)?,
                input.source_type,
                input.source_path,
                input.source_record_id,
                input.corpus_root,
                input.corpus_path,
                content_hash,
                input.content,
                redaction.text,
                excerpt,
                input.frontmatter.to_string(),
                input.imported_at,
                updated_at,
            ],
        )?;
        replace_chunks(&tx, &input.id, &input.content)?;
        refresh_fts(&tx, &input.id)?;
        tx.commit()?;
        Ok(())
    }

    pub fn record_import(&self, report: &ImportReport) -> Result<()> {
        self.connect()?.execute(
            r#"
            INSERT INTO imports(id, root, imported, skipped, raw_records, files, created_at)
            VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
            params![
                stable_id(["import", &report.root, &report.at]),
                report.root,
                report.imported as i64,
                report.skipped as i64,
                report.raw_records as i64,
                report.files as i64,
                report.at,
            ],
        )?;
        Ok(())
    }

    pub fn search(&self, input: SearchRequest) -> Result<SearchResponse> {
        let results = self.search_lexical(&input)?;
        Ok(SearchResponse {
            mode: input.mode,
            query: input.query,
            results,
            facets: self.facets()?,
            stats: self.stats()?,
            hybrid_available: matches!(input.mode, SearchMode::Hybrid),
            hybrid_reason: "FTS search is authoritative; embeddings rerank when configured."
                .to_string(),
        })
    }

    pub fn search_lexical(&self, input: &SearchRequest) -> Result<Vec<PromptSummary>> {
        let conn = self.connect()?;
        let query = input.query.trim();
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        let mut where_sql: Vec<String> = Vec::new();
        if let Some(kind) = &input.kind {
            where_sql.push("d.kind = ?".to_string());
            args.push(Box::new(kind.clone()));
        }
        if let Some(status) = &input.status {
            where_sql.push("d.status = ?".to_string());
            args.push(Box::new(status.clone()));
        }
        if let Some(tag) = &input.tag {
            where_sql.push(json_array_contains("d.tags_json"));
            args.push(Box::new(tag.clone()));
        }
        if let Some(risk) = &input.risk {
            where_sql.push("d.risk_flags_json LIKE ?".to_string());
            args.push(Box::new(format!("%\"{risk}\"%")));
        }

        let mut sql = "SELECT d.*, 0.0 AS score FROM documents d".to_string();
        if !query.is_empty() {
            sql = r#"
                SELECT d.*, bm25(documents_fts) * -1.0 AS score
                FROM documents_fts
                JOIN documents d ON d.id = documents_fts.id
            "#
            .to_string();
            where_sql.push("documents_fts MATCH ?".to_string());
            args.push(Box::new(fts_query(query)));
        }
        if !where_sql.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&where_sql.join(" AND "));
        }
        sql.push_str(if query.is_empty() {
            " ORDER BY d.updated_at DESC LIMIT ?"
        } else {
            " ORDER BY score DESC, d.updated_at DESC LIMIT ?"
        });
        args.push(Box::new(input.limit as i64));
        let params = rusqlite::params_from_iter(args.iter().map(|arg| arg.as_ref()));
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params, summary_from_row)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn get_prompt(&self, id: &str) -> Result<Option<PromptDetail>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare("SELECT *, 0.0 AS score FROM documents WHERE id = ?")?;
        let Some((summary, content, redacted, frontmatter)) = stmt
            .query_row([id], |row| {
                Ok((
                    summary_from_row(row)?,
                    row.get::<_, String>("content")?,
                    row.get::<_, String>("redacted_content")?,
                    row.get::<_, String>("frontmatter_json")?,
                ))
            })
            .optional()?
        else {
            return Ok(None);
        };
        let versions = versions(&conn, id)?;
        let related = related(&conn, &summary)?;
        Ok(Some(PromptDetail {
            summary,
            content,
            redacted_content: redacted,
            frontmatter: serde_json::from_str(&frontmatter).unwrap_or_else(|_| json!({})),
            versions,
            related,
        }))
    }

    pub fn patch_prompt(&self, id: &str, patch: PatchPrompt) -> Result<Option<PromptDetail>> {
        let Some(current) = self.get_prompt(id)? else {
            return Ok(None);
        };
        let mut conn = self.connect()?;
        let tx = conn.transaction()?;
        let title = patch.title.unwrap_or_else(|| current.summary.title.clone());
        let content = patch.content.unwrap_or_else(|| current.content.clone());
        let status = patch
            .status
            .unwrap_or_else(|| current.summary.status.clone());
        let favorite = patch.favorite.unwrap_or(current.summary.favorite);
        let tags = patch.tags.unwrap_or_else(|| current.summary.tags.clone());
        let reason = patch.reason.unwrap_or_else(|| "Promptbar edit".to_string());

        if title != current.summary.title || content != current.content {
            tx.execute(
                r#"
                INSERT INTO versions(id, document_id, title, content_hash, content, reason, created_at)
                VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
                "#,
                params![
                    stable_id(["version", id, &current.summary.content_hash, &now_iso()]),
                    id,
                    current.summary.title,
                    current.summary.content_hash,
                    current.content,
                    reason,
                    now_iso(),
                ],
            )?;
        }

        let redaction = redact::redact(&content);
        let risk_flags = merge_lists(current.summary.risk_flags, redaction.risk_flags);
        tx.execute(
            r#"
            UPDATE documents SET
                title=?1,
                content=?2,
                redacted_content=?3,
                content_hash=?4,
                excerpt=?5,
                tags_json=?6,
                risk_flags_json=?7,
                status=?8,
                favorite=?9,
                updated_at=?10
            WHERE id=?11
            "#,
            params![
                title,
                content,
                redaction.text,
                sha256(&content),
                excerpt(&redaction.text),
                to_json(&tags)?,
                to_json(&risk_flags)?,
                status,
                bool_to_i64(favorite),
                now_iso(),
                id,
            ],
        )?;
        tx.execute(
            r#"
            INSERT INTO overlays(id, document_id, title, status, favorite, tags_json, reason, created_at)
            VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                stable_id(["overlay", id, &now_iso()]),
                id,
                title,
                status,
                bool_to_i64(favorite),
                to_json(&tags)?,
                reason,
                now_iso(),
            ],
        )?;
        replace_chunks(&tx, id, &content)?;
        refresh_fts(&tx, id)?;
        tx.commit()?;
        self.get_prompt(id)
    }

    pub fn export_prompts(
        &self,
        ids: &[String],
        out_dir: &Path,
        raw: bool,
    ) -> Result<ExportReport> {
        fs::create_dir_all(out_dir).at_path(out_dir)?;
        let mut files = Vec::new();
        for id in ids {
            let Some(prompt) = self.get_prompt(id)? else {
                continue;
            };
            let safe_title = safe_file_stem(&prompt.summary.title);
            let file = out_dir.join(format!("{safe_title}-{}.md", short_id(&prompt.summary.id)));
            let content = if raw {
                &prompt.content
            } else {
                &prompt.redacted_content
            };
            let frontmatter = json!({
                "id": prompt.summary.id,
                "title": prompt.summary.title,
                "kind": prompt.summary.kind,
                "status": prompt.summary.status,
                "sourcePath": prompt.summary.source_path,
                "contentHash": prompt.summary.content_hash,
                "riskFlags": prompt.summary.risk_flags,
                "exportedAt": now_iso(),
                "redacted": !raw,
            });
            let body = format!(
                "---\n{}\n---\n\n{}\n",
                pretty_json(&frontmatter),
                content.trim()
            );
            fs::write(&file, body).at_path(&file)?;
            files.push(file.display().to_string());
        }
        Ok(ExportReport {
            out_dir: out_dir.display().to_string(),
            exported: files.len(),
            redacted: !raw,
            files,
        })
    }

    pub fn save_eval_run(&self, run: SaveEvalRun) -> Result<SaveEvalRun> {
        let conn = self.connect()?;
        conn.execute(
            r#"
            INSERT INTO eval_runs(id, created_at, mode, model, payload_json)
            VALUES(?1, ?2, ?3, ?4, ?5)
            "#,
            params![
                &run.id,
                &run.created_at,
                &run.mode,
                &run.model,
                run.payload.to_string(),
            ],
        )?;
        Ok(run)
    }

    pub fn stats(&self) -> Result<CorpusStats> {
        let conn = self.connect()?;
        let latest: Option<String> = conn
            .query_row("SELECT MAX(created_at) FROM imports", [], |row| row.get(0))
            .optional()?
            .flatten();
        Ok(CorpusStats {
            documents: count(&conn, "SELECT COUNT(*) FROM documents")?,
            chunks: count(&conn, "SELECT COUNT(*) FROM chunks")?,
            favorites: count(&conn, "SELECT COUNT(*) FROM documents WHERE favorite=1")?,
            risks: count(
                &conn,
                "SELECT COUNT(*) FROM documents WHERE risk_flags_json!='[]'",
            )?,
            eval_runs: count(&conn, "SELECT COUNT(*) FROM eval_runs")?,
            embedded_chunks: count(
                &conn,
                "SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL",
            )?,
            latest_import_at: latest,
            default_import_root: default_import_root(),
        })
    }

    pub fn facets(&self) -> Result<Facets> {
        let conn = self.connect()?;
        Ok(Facets {
            kinds: facet(&conn, "kind")?,
            statuses: facet(&conn, "status")?,
            tags: json_facet(&conn, "tags_json")?,
            risks: json_facet(&conn, "risk_flags_json")?,
        })
    }

    pub fn embed_status(&self) -> Result<EmbedStatus> {
        let conn = self.connect()?;
        let model: Option<String> = conn
            .query_row(
                "SELECT embedding_model FROM chunks WHERE embedding_model IS NOT NULL ORDER BY rowid DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()?;
        Ok(EmbedStatus {
            chunks: count(&conn, "SELECT COUNT(*) FROM chunks")?,
            embedded_chunks: count(
                &conn,
                "SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL",
            )?,
            model,
        })
    }

    pub fn chunks_missing_embeddings(
        &self,
        model: &str,
        dimensions: Option<usize>,
        limit: usize,
    ) -> Result<Vec<(String, String)>> {
        let conn = self.connect()?;
        let sql = if dimensions.is_some() {
            r#"
            SELECT id, content FROM chunks
            WHERE embedding IS NULL OR embedding_model != ? OR embedding_dim != ?
            ORDER BY rowid ASC
            LIMIT ?
            "#
        } else {
            r#"
            SELECT id, content FROM chunks
            WHERE embedding IS NULL OR embedding_model != ?
            ORDER BY rowid ASC
            LIMIT ?
            "#
        };
        let mut stmt = conn.prepare(sql)?;
        let map_row = |row: &Row<'_>| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?));
        let rows = if let Some(dimensions) = dimensions {
            stmt.query_map(params![model, dimensions as i64, limit as i64], map_row)?
        } else {
            stmt.query_map(params![model, limit as i64], map_row)?
        };
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn store_embedding(&self, chunk_id: &str, model: &str, vector: &[f32]) -> Result<()> {
        let bytes = f32_vec_to_bytes(vector);
        self.connect()?.execute(
            r#"
            UPDATE chunks SET embedding_model=?1, embedding_dim=?2, embedding=?3
            WHERE id=?4
            "#,
            params![model, vector.len() as i64, bytes, chunk_id],
        )?;
        Ok(())
    }

    pub fn embedded_chunks_for_documents(
        &self,
        document_ids: &[String],
        model: &str,
        dimensions: Option<usize>,
    ) -> Result<Vec<(String, Vec<f32>)>> {
        if document_ids.is_empty() {
            return Ok(Vec::new());
        }
        let marks = document_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");
        let sql = if dimensions.is_some() {
            format!(
                "SELECT document_id, embedding FROM chunks WHERE document_id IN ({marks}) AND embedding_model = ? AND embedding_dim = ? AND embedding IS NOT NULL"
            )
        } else {
            format!(
                "SELECT document_id, embedding FROM chunks WHERE document_id IN ({marks}) AND embedding_model = ? AND embedding IS NOT NULL"
            )
        };
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = document_ids
            .iter()
            .cloned()
            .map(|id| Box::new(id) as Box<dyn rusqlite::ToSql>)
            .collect();
        args.push(Box::new(model.to_string()));
        if let Some(dimensions) = dimensions {
            args.push(Box::new(dimensions as i64));
        }
        let params = rusqlite::params_from_iter(args.iter().map(|arg| arg.as_ref()));
        let conn = self.connect()?;
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params, |row| {
            let bytes: Vec<u8> = row.get(1)?;
            Ok((row.get::<_, String>(0)?, bytes_to_f32_vec(&bytes)))
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }
}

fn insert_event_on_conn(conn: &Connection, input: EventInput) -> Result<bool> {
    let redaction = redact::redact(&input.content);
    let content_hash = sha256(&input.content);
    let inserted = conn.execute(
        r#"
        INSERT OR IGNORE INTO prompt_events(
            id, kind, source, session_id, turn_id, call_id, cwd, model,
            transcript_path, event_at, content, redacted_content,
            content_hash, risk_flags_json, tags_json, metadata_json, created_at
        )
        VALUES(
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
            ?14, ?15, ?16, ?17
        )
        "#,
        params![
            input.id,
            input.kind,
            input.source,
            input.session_id,
            input.turn_id,
            input.call_id,
            input.cwd,
            input.model,
            input.transcript_path,
            input.event_at,
            input.content,
            redaction.text,
            content_hash,
            to_json(&redaction.risk_flags)?,
            to_json(&input.tags)?,
            input.metadata.to_string(),
            now_iso(),
        ],
    )? == 1;
    Ok(inserted)
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn sha256(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn blake3_id(parts: impl IntoIterator<Item = impl AsRef<str>>) -> String {
    let mut hasher = blake3::Hasher::new();
    for part in parts {
        hasher.update(part.as_ref().as_bytes());
        hasher.update(b"\x1f");
    }
    format!("b3:{}", hasher.finalize().to_hex())
}

pub fn stable_id(parts: impl IntoIterator<Item = impl AsRef<str>>) -> String {
    blake3_id(parts)
}

pub fn content_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| CONTENT_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn apply_migrations(conn: &mut Connection) -> Result<()> {
    let migrations = [M::up(
        r#"
        CREATE TABLE IF NOT EXISTS sources(
            id TEXT PRIMARY KEY,
            source_type TEXT NOT NULL,
            root TEXT NOT NULL,
            label TEXT NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS prompt_events(
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            source TEXT NOT NULL,
            session_id TEXT,
            turn_id TEXT,
            call_id TEXT,
            cwd TEXT,
            model TEXT,
            transcript_path TEXT,
            event_at TEXT NOT NULL,
            content TEXT NOT NULL,
            redacted_content TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            risk_flags_json TEXT NOT NULL DEFAULT '[]',
            tags_json TEXT NOT NULL DEFAULT '[]',
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS documents(
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            kind TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'inbox',
            favorite INTEGER NOT NULL DEFAULT 0,
            tags_json TEXT NOT NULL DEFAULT '[]',
            risk_flags_json TEXT NOT NULL DEFAULT '[]',
            source_type TEXT NOT NULL,
            source_path TEXT NOT NULL,
            source_record_id TEXT,
            corpus_root TEXT,
            corpus_path TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            content TEXT NOT NULL,
            redacted_content TEXT NOT NULL,
            excerpt TEXT NOT NULL,
            frontmatter_json TEXT NOT NULL DEFAULT '{}',
            imported_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chunks(
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL,
            content TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            token_estimate INTEGER NOT NULL,
            embedding_model TEXT,
            embedding_dim INTEGER,
            embedding BLOB
        );

        CREATE TABLE IF NOT EXISTS versions(
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            content TEXT NOT NULL,
            reason TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS overlays(
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            title TEXT,
            status TEXT,
            favorite INTEGER,
            tags_json TEXT,
            reason TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS eval_runs(
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            mode TEXT NOT NULL,
            model TEXT NOT NULL,
            payload_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS imports(
            id TEXT PRIMARY KEY,
            root TEXT NOT NULL,
            imported INTEGER NOT NULL,
            skipped INTEGER NOT NULL,
            raw_records INTEGER NOT NULL,
            files INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts
        USING fts5(id UNINDEXED, title, tags, source_path, content);

        CREATE INDEX IF NOT EXISTS idx_documents_kind ON documents(kind);
        CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
        CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(content_hash);
        CREATE INDEX IF NOT EXISTS idx_documents_source_path ON documents(source_path);
        CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
        CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON chunks(embedding_model, embedding_dim);
        CREATE INDEX IF NOT EXISTS idx_events_kind ON prompt_events(kind);
        CREATE INDEX IF NOT EXISTS idx_events_session ON prompt_events(session_id);
        "#,
    )];
    Migrations::from_slice(&migrations).to_latest(conn)?;
    Ok(())
}

fn replace_chunks(conn: &Connection, document_id: &str, content: &str) -> Result<()> {
    let chunks = chunk_content(content);
    let mut stmt = conn.prepare(
        r#"
        INSERT INTO chunks(id, document_id, ordinal, content, content_hash, token_estimate)
        VALUES(?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(id) DO UPDATE SET
            ordinal=excluded.ordinal,
            content=excluded.content,
            content_hash=excluded.content_hash,
            token_estimate=excluded.token_estimate
        "#,
    )?;
    let mut active_ids = Vec::new();
    for (index, chunk) in chunks.iter().enumerate() {
        let id = stable_id(["chunk", document_id, &index.to_string(), &sha256(chunk)]);
        stmt.execute(params![
            id,
            document_id,
            index as i64,
            chunk,
            sha256(chunk),
            estimate_tokens(chunk) as i64,
        ])?;
        active_ids.push(id);
    }
    if active_ids.is_empty() {
        conn.execute("DELETE FROM chunks WHERE document_id = ?", [document_id])?;
    } else {
        let marks = active_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!("DELETE FROM chunks WHERE document_id = ? AND id NOT IN ({marks})");
        let mut params: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(active_ids.len() + 1);
        params.push(&document_id);
        for id in &active_ids {
            params.push(id);
        }
        conn.execute(&sql, rusqlite::params_from_iter(params))?;
    }
    Ok(())
}

fn refresh_fts(conn: &Connection, document_id: &str) -> Result<()> {
    conn.execute("DELETE FROM documents_fts WHERE id = ?", [document_id])?;
    conn.execute(
        r#"
        INSERT INTO documents_fts(id, title, tags, source_path, content)
        SELECT id, title, tags_json, source_path, redacted_content
        FROM documents WHERE id = ?
        "#,
        [document_id],
    )?;
    Ok(())
}

fn chunk_content(content: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for paragraph in content
        .split("\n\n")
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        let next_len = current.len() + paragraph.len() + 2;
        if next_len > 1800 && !current.is_empty() {
            chunks.push(std::mem::take(&mut current));
        }
        if !current.is_empty() {
            current.push_str("\n\n");
        }
        current.push_str(paragraph);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    if chunks.is_empty() && !content.trim().is_empty() {
        chunks.push(content.trim().to_string());
    }
    chunks
}

fn estimate_tokens(content: &str) -> usize {
    (content.len() / 4).max(1)
}

fn count(conn: &Connection, sql: &str) -> Result<usize> {
    conn.query_row(sql, [], |row| row.get::<_, i64>(0))
        .map(|value| value as usize)
        .map_err(Into::into)
}

fn facet(conn: &Connection, column: &str) -> Result<Vec<FacetValue>> {
    let sql = format!(
        "SELECT {column} AS value, COUNT(*) AS count FROM documents GROUP BY {column} ORDER BY count DESC, value ASC LIMIT 100"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(FacetValue {
            value: row.get(0)?,
            count: row.get::<_, i64>(1)? as usize,
        })
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn json_facet(conn: &Connection, column: &str) -> Result<Vec<FacetValue>> {
    let sql = format!("SELECT {column} FROM documents");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut counts: HashMap<String, usize> = HashMap::new();
    for row in rows {
        for item in parse_list(&row?) {
            *counts.entry(item).or_insert(0) += 1;
        }
    }
    let mut values: Vec<_> = counts
        .into_iter()
        .map(|(value, count)| FacetValue { value, count })
        .collect();
    values.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    values.truncate(100);
    Ok(values)
}

fn summary_from_row(row: &Row<'_>) -> rusqlite::Result<PromptSummary> {
    Ok(PromptSummary {
        id: row.get("id")?,
        title: row.get("title")?,
        kind: row.get("kind")?,
        status: row.get("status")?,
        favorite: row.get::<_, i64>("favorite")? != 0,
        tags: parse_list(&row.get::<_, String>("tags_json")?),
        risk_flags: parse_list(&row.get::<_, String>("risk_flags_json")?),
        source_path: row.get("source_path")?,
        corpus_path: row.get("corpus_path")?,
        excerpt: row.get("excerpt")?,
        content_hash: row.get("content_hash")?,
        updated_at: row.get("updated_at")?,
        score: row.get("score")?,
        semantic_score: None,
    })
}

fn versions(conn: &Connection, document_id: &str) -> Result<Vec<PromptVersion>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT id, document_id, created_at, title, content_hash, content, reason
        FROM versions WHERE document_id = ?
        ORDER BY created_at DESC LIMIT 20
        "#,
    )?;
    let rows = stmt.query_map([document_id], |row| {
        Ok(PromptVersion {
            id: row.get(0)?,
            document_id: row.get(1)?,
            created_at: row.get(2)?,
            title: row.get(3)?,
            content_hash: row.get(4)?,
            content: row.get(5)?,
            reason: row.get(6)?,
        })
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn related(conn: &Connection, prompt: &PromptSummary) -> Result<Vec<PromptSummary>> {
    let tags = prompt.tags.iter().take(3).cloned().collect::<Vec<_>>();
    if tags.is_empty() {
        return Ok(Vec::new());
    }
    let mut where_sql = Vec::new();
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(prompt.id.clone())];
    for tag in tags {
        where_sql.push(json_array_contains("documents.tags_json"));
        args.push(Box::new(tag));
    }
    let sql = format!(
        "SELECT *, 0.0 AS score FROM documents WHERE id != ? AND ({}) ORDER BY updated_at DESC LIMIT 6",
        where_sql.join(" OR ")
    );
    let params = rusqlite::params_from_iter(args.iter().map(|arg| arg.as_ref()));
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params, summary_from_row)?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn fts_query(value: &str) -> String {
    let terms = value
        .split_whitespace()
        .map(|term| term.replace(['"', '*'], "").trim().to_string())
        .filter(|term| term.len() > 1)
        .take(12)
        .collect::<Vec<_>>();
    if terms.is_empty() {
        "\"\"".to_string()
    } else {
        terms
            .iter()
            .map(|term| format!("\"{term}\"*"))
            .collect::<Vec<_>>()
            .join(" OR ")
    }
}

fn excerpt(content: &str) -> String {
    let normalized = content.split_whitespace().collect::<Vec<_>>().join(" ");
    normalized.chars().take(260).collect()
}

fn parse_list(value: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(value).unwrap_or_default()
}

fn json_array_contains(column: &str) -> String {
    format!(
        "EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid({column}) THEN CASE WHEN json_type({column}) = 'array' THEN {column} ELSE '[]' END ELSE '[]' END) AS item WHERE item.value = ?)"
    )
}

fn to_json(value: &[String]) -> Result<String> {
    serde_json::to_string(value).map_err(Into::into)
}

fn merge_lists(mut left: Vec<String>, right: Vec<String>) -> Vec<String> {
    left.extend(right);
    left.sort();
    left.dedup();
    left
}

fn bool_to_i64(value: bool) -> i64 {
    if value { 1 } else { 0 }
}

fn pretty_json(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".to_string())
}

fn safe_file_stem(value: &str) -> String {
    let safe = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    safe.chars()
        .take(80)
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn short_id(id: &str) -> String {
    id.chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(10)
        .collect()
}

fn f32_vec_to_bytes(vector: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(std::mem::size_of_val(vector));
    for value in vector {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

fn bytes_to_f32_vec(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

fn append_jsonl_private(path: &Path, value: &Value) -> Result<()> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).at_path(parent)?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .at_path(path)?;
    writeln!(file, "{}", value).at_path(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).at_path(path)?;
    }
    Ok(())
}

fn default_import_root() -> String {
    std::env::var("PROMPTOPS_DEFAULT_IMPORT_ROOT")
        .or_else(|_| std::env::var("PROMPTBAR_DEFAULT_IMPORT_ROOT"))
        .or_else(|_| std::env::var("HOME").map(|home| format!("{home}/prompt_library")))
        .unwrap_or_else(|_| {
            std::env::current_dir()
                .map(|dir| format!("{}/prompt_library", dir.display()))
                .unwrap_or_default()
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ingest;

    #[test]
    fn chunk_content_groups_paragraphs() {
        let chunks = chunk_content("a\n\nb\n\nc");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0], "a\n\nb\n\nc");
    }

    #[test]
    fn tag_search_matches_exact_json_members() {
        let temp = tempfile::tempdir().expect("tempdir");
        let paths = StatePaths {
            state_root: temp.path().join("state"),
            config_root: temp.path().join("config"),
            cache_root: temp.path().join("cache"),
            db_path: temp.path().join("state/promptops.sqlite"),
            raw_dir: temp.path().join("state/raw"),
            audit_log: temp.path().join("state/audit.jsonl"),
            config_file: temp.path().join("config/config.toml"),
        };
        let store = Store::open(paths).expect("store");
        for (id, tag) in [
            ("percent", "100%"),
            ("percent-lookalike", "100x"),
            ("underscore", "a_b"),
            ("underscore-lookalike", "axb"),
            ("quote", "a\"b"),
            ("all", "all"),
            ("padded", " agent "),
            ("object", "object-placeholder"),
        ] {
            store
                .upsert_document(DocumentInput {
                    id: id.to_string(),
                    title: id.to_string(),
                    kind: "canon".to_string(),
                    status: "inbox".to_string(),
                    favorite: false,
                    tags: vec![tag.to_string()],
                    risk_flags: Vec::new(),
                    source_type: "test".to_string(),
                    source_path: format!("{id}.md"),
                    source_record_id: None,
                    corpus_root: None,
                    corpus_path: format!("canon/{id}.md"),
                    content: format!("# {id}"),
                    frontmatter: json!({}),
                    imported_at: now_iso(),
                })
                .expect("document");
        }
        store
            .connect()
            .expect("connection")
            .execute(
                "UPDATE documents SET tags_json = 'not-json' WHERE id = 'percent-lookalike'",
                [],
            )
            .expect("malformed legacy row");
        let conn = store.connect().expect("connection");
        conn.execute(
            "UPDATE documents SET tags_json = '\"all\"' WHERE id = 'underscore-lookalike'",
            [],
        )
        .expect("scalar legacy row");
        conn.execute(
            "UPDATE documents SET tags_json = '{\"tag\":\"all\"}' WHERE id = 'object'",
            [],
        )
        .expect("object legacy row");

        for (tag, expected_id) in [
            ("100%", "percent"),
            ("a_b", "underscore"),
            ("a\"b", "quote"),
            ("all", "all"),
            (" agent ", "padded"),
        ] {
            let results = store
                .search_lexical(&SearchRequest {
                    query: String::new(),
                    mode: SearchMode::Lexical,
                    kind: None,
                    status: None,
                    tag: Some(tag.to_string()),
                    risk: None,
                    limit: 10,
                })
                .expect("tag search");
            assert_eq!(
                results
                    .iter()
                    .map(|prompt| prompt.id.as_str())
                    .collect::<Vec<_>>(),
                vec![expected_id],
            );
        }
        let detail = store
            .get_prompt("all")
            .expect("prompt query")
            .expect("prompt");
        assert!(detail.related.is_empty());
    }

    #[test]
    fn search_contract_covers_filters_limit_empty_query_and_result_shape() {
        let temp = tempfile::tempdir().expect("tempdir");
        let paths = StatePaths {
            state_root: temp.path().join("state"),
            config_root: temp.path().join("config"),
            cache_root: temp.path().join("cache"),
            db_path: temp.path().join("state/promptops.sqlite"),
            raw_dir: temp.path().join("state/raw"),
            audit_log: temp.path().join("state/audit.jsonl"),
            config_file: temp.path().join("config/config.toml"),
        };
        let store = Store::open(paths).expect("store");
        for (id, kind, status, tags) in [
            ("match", "canon", "reviewed", vec!["agent", "workflow"]),
            ("wrong-kind", "reference", "reviewed", vec!["agent"]),
            ("wrong-status", "canon", "inbox", vec!["agent"]),
            ("wrong-tag", "canon", "reviewed", vec!["other"]),
        ] {
            store
                .upsert_document(DocumentInput {
                    id: id.to_string(),
                    title: format!("Termination {id}"),
                    kind: kind.to_string(),
                    status: status.to_string(),
                    favorite: id == "match",
                    tags: tags.into_iter().map(str::to_string).collect(),
                    risk_flags: if id == "match" {
                        vec!["network".to_string()]
                    } else {
                        Vec::new()
                    },
                    source_type: "test".to_string(),
                    source_path: format!("/corpus/{id}.md"),
                    source_record_id: None,
                    corpus_root: Some("/corpus".to_string()),
                    corpus_path: format!("canon/{id}.md"),
                    content: format!("Design a termination-aware workflow for {id}."),
                    frontmatter: json!({}),
                    imported_at: "2026-07-15T00:00:00Z".to_string(),
                })
                .expect("document");
        }

        let response = store
            .search(SearchRequest {
                query: "termination".to_string(),
                mode: SearchMode::Lexical,
                kind: Some("canon".to_string()),
                status: Some("reviewed".to_string()),
                tag: Some("agent".to_string()),
                risk: None,
                limit: 7,
            })
            .expect("filtered search");

        assert_eq!(response.mode, SearchMode::Lexical);
        assert_eq!(response.query, "termination");
        assert!(!response.hybrid_available);
        assert_eq!(response.results.len(), 1);
        let result = &response.results[0];
        assert_eq!(result.id, "match");
        assert_eq!(result.title, "Termination match");
        assert_eq!(result.kind, "canon");
        assert_eq!(result.status, "reviewed");
        assert!(result.favorite);
        assert_eq!(result.tags, ["agent", "workflow"]);
        assert_eq!(result.risk_flags, ["network"]);
        assert_eq!(result.source_path, "/corpus/match.md");
        assert_eq!(result.corpus_path, "canon/match.md");
        assert_eq!(result.content_hash.len(), 64);
        assert!(result.excerpt.contains("termination-aware"));
        assert!(result.score.is_finite());
        assert_eq!(result.semantic_score, None);
        assert_eq!(response.stats.documents, 4);
        assert_eq!(response.facets.kinds[0].value, "canon");
        assert_eq!(response.facets.kinds[0].count, 3);

        let limited = store
            .search_lexical(&SearchRequest {
                query: "termination".to_string(),
                mode: SearchMode::Lexical,
                kind: None,
                status: None,
                tag: None,
                risk: None,
                limit: 2,
            })
            .expect("limited search");
        assert_eq!(limited.len(), 2);

        let sanitized_multi_term = store
            .search_lexical(&SearchRequest {
                query: "\"termin\"* absent".to_string(),
                mode: SearchMode::Lexical,
                kind: None,
                status: None,
                tag: None,
                risk: None,
                limit: 10,
            })
            .expect("sanitized multi-term search");
        assert_eq!(sanitized_multi_term.len(), 4);

        let empty_query = store
            .search_lexical(&SearchRequest {
                query: String::new(),
                mode: SearchMode::Lexical,
                kind: Some("canon".to_string()),
                status: Some("reviewed".to_string()),
                tag: Some("agent".to_string()),
                risk: None,
                limit: 1,
            })
            .expect("empty filtered search");
        assert_eq!(empty_query.len(), 1);
        assert_eq!(empty_query[0].id, "match");
    }

    #[test]
    fn import_search_patch_and_export_redacted() {
        let temp = tempfile::tempdir().expect("tempdir");
        let corpus = temp.path().join("corpus");
        let canon = corpus.join("canon");
        fs::create_dir_all(&canon).expect("canon dir");
        fs::write(
            canon.join("capture.md"),
            "# Capture Prompt\n\nUse this prompt for promptops search with token=secret and sk-proj-abcdefghijklmnopqrstuvwxyz.",
        )
        .expect("fixture");

        let paths = StatePaths {
            state_root: temp.path().join("state"),
            config_root: temp.path().join("config"),
            cache_root: temp.path().join("cache"),
            db_path: temp.path().join("state/promptops.sqlite"),
            raw_dir: temp.path().join("state/raw"),
            audit_log: temp.path().join("state/audit.jsonl"),
            config_file: temp.path().join("config/config.toml"),
        };
        let store = Store::open(paths).expect("store");
        let report = ingest::import_corpus(&store, &corpus).expect("import");
        assert_eq!(report.imported, 1);

        let response = store
            .search(SearchRequest {
                query: "promptops".to_string(),
                mode: SearchMode::Lexical,
                kind: Some("canon".to_string()),
                status: None,
                tag: None,
                risk: None,
                limit: 10,
            })
            .expect("search");
        assert_eq!(response.results.len(), 1);

        let id = response.results[0].id.clone();
        let updated = store
            .patch_prompt(
                &id,
                PatchPrompt {
                    title: Some("Updated Capture".to_string()),
                    content: None,
                    status: Some("reviewed".to_string()),
                    favorite: Some(true),
                    tags: None,
                    reason: Some("test".to_string()),
                },
            )
            .expect("patch")
            .expect("prompt");
        assert_eq!(updated.summary.status, "reviewed");
        assert!(updated.summary.favorite);

        let out = temp.path().join("exports");
        let export = store.export_prompts(&[id], &out, false).expect("export");
        assert_eq!(export.exported, 1);
        let exported = fs::read_to_string(&export.files[0]).expect("exported file");
        assert!(exported.contains("sensitive-keyword"));
        assert!(exported.contains("[REDACTED_OPENAI_KEY]"));
        assert!(!exported.contains("sk-proj-abcdefghijklmnopqrstuvwxyz"));
    }

    #[test]
    fn import_missing_root_returns_empty_report() {
        let temp = tempfile::tempdir().expect("tempdir");
        let missing = temp.path().join("missing-corpus");
        let paths = StatePaths {
            state_root: temp.path().join("state"),
            config_root: temp.path().join("config"),
            cache_root: temp.path().join("cache"),
            db_path: temp.path().join("state/promptops.sqlite"),
            raw_dir: temp.path().join("state/raw"),
            audit_log: temp.path().join("state/audit.jsonl"),
            config_file: temp.path().join("config/config.toml"),
        };
        let store = Store::open(paths).expect("store");

        let report = ingest::import_corpus(&store, &missing).expect("import");

        assert_eq!(report.root, missing.display().to_string());
        assert_eq!(report.imported, 0);
        assert_eq!(report.skipped, 0);
        assert_eq!(report.raw_records, 0);
        assert_eq!(report.files, 0);
    }
}
