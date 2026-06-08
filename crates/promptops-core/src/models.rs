use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const OUTPUT_SCHEMA: &str = "promptops.output.v1";
pub const DB_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Output<T> {
    pub schema: &'static str,
    pub data: T,
}

impl<T> Output<T> {
    pub fn new(data: T) -> Self {
        Self {
            schema: OUTPUT_SCHEMA,
            data,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoctorReport {
    pub ok: bool,
    pub state_root: String,
    pub config_root: String,
    pub cache_root: String,
    pub db_path: String,
    pub raw_dir: String,
    pub audit_log: String,
    pub db_exists: bool,
    pub db_schema_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureStats {
    pub files: usize,
    pub records: usize,
    pub inserted: usize,
    pub skipped: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportReport {
    pub root: String,
    pub imported: usize,
    pub skipped: usize,
    pub raw_records: usize,
    pub files: usize,
    pub at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchRequest {
    pub query: String,
    pub mode: SearchMode,
    pub kind: Option<String>,
    pub status: Option<String>,
    pub tag: Option<String>,
    pub risk: Option<String>,
    pub limit: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SearchMode {
    Lexical,
    Hybrid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResponse {
    pub mode: SearchMode,
    pub query: String,
    pub results: Vec<PromptSummary>,
    pub facets: Facets,
    pub stats: CorpusStats,
    pub hybrid_available: bool,
    pub hybrid_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptSummary {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub status: String,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub risk_flags: Vec<String>,
    pub source_path: String,
    pub corpus_path: String,
    pub excerpt: String,
    pub content_hash: String,
    pub updated_at: String,
    pub score: f64,
    pub semantic_score: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptDetail {
    #[serde(flatten)]
    pub summary: PromptSummary,
    pub content: String,
    pub redacted_content: String,
    pub frontmatter: Value,
    pub versions: Vec<PromptVersion>,
    pub related: Vec<PromptSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptVersion {
    pub id: String,
    pub document_id: String,
    pub created_at: String,
    pub title: String,
    pub content_hash: String,
    pub content: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorpusStats {
    pub documents: usize,
    pub chunks: usize,
    pub favorites: usize,
    pub risks: usize,
    pub eval_runs: usize,
    pub embedded_chunks: usize,
    pub latest_import_at: Option<String>,
    pub default_import_root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Facets {
    pub kinds: Vec<FacetValue>,
    pub statuses: Vec<FacetValue>,
    pub tags: Vec<FacetValue>,
    pub risks: Vec<FacetValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FacetValue {
    pub value: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchPrompt {
    pub title: Option<String>,
    pub content: Option<String>,
    pub status: Option<String>,
    pub favorite: Option<bool>,
    pub tags: Option<Vec<String>>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveEvalRun {
    pub id: String,
    pub created_at: String,
    pub mode: String,
    pub model: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportReport {
    pub out_dir: String,
    pub exported: usize,
    pub redacted: bool,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbedConfig {
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
    pub dimensions: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbedStatus {
    pub chunks: usize,
    pub embedded_chunks: usize,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbedReport {
    pub model: String,
    pub embedded: usize,
    pub skipped: usize,
}
