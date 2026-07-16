use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;

use crate::db::Store;
use crate::error::Result;
use crate::models::{EmbedConfig, EmbedReport, SearchRequest, SearchResponse};

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingDatum>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingDatum {
    embedding: Vec<f32>,
}

#[derive(Debug, Serialize)]
struct EmbeddingRequest<'a> {
    model: &'a str,
    input: &'a [String],
    #[serde(skip_serializing_if = "Option::is_none")]
    dimensions: Option<usize>,
}

pub async fn rebuild_embeddings(
    store: &Store,
    config: &EmbedConfig,
    limit: usize,
) -> Result<EmbedReport> {
    let chunks = store.chunks_missing_embeddings(&config.model, config.dimensions, limit)?;
    if chunks.is_empty() {
        return Ok(EmbedReport {
            model: config.model.clone(),
            embedded: 0,
            skipped: 0,
        });
    }
    let client = embedding_client()?;
    let url = format!("{}/embeddings", config.base_url.trim_end_matches('/'));
    let values = chunks
        .iter()
        .map(|(_, content)| content.clone())
        .collect::<Vec<_>>();
    let mut request = client.post(url).json(&EmbeddingRequest {
        model: &config.model,
        input: &values,
        dimensions: config.dimensions,
    });
    if let Some(api_key) = &config.api_key
        && !api_key.is_empty()
    {
        request = request.bearer_auth(api_key);
    }
    let response = request.send().await?.error_for_status()?;
    let payload = response.json::<EmbeddingResponse>().await?;
    let mut embedded = 0;
    for ((chunk_id, _), datum) in chunks.iter().zip(payload.data.iter()) {
        store.store_embedding(chunk_id, &config.model, &datum.embedding)?;
        embedded += 1;
    }
    store.append_audit(
        "embed_rebuild",
        json!({"model": config.model, "embedded": embedded, "requested": chunks.len()}),
    )?;
    Ok(EmbedReport {
        model: config.model.clone(),
        embedded,
        skipped: chunks.len().saturating_sub(embedded),
    })
}

pub async fn hybrid_search(
    store: &Store,
    request: SearchRequest,
    config: Option<&EmbedConfig>,
) -> Result<SearchResponse> {
    let mut response = store.search(request.clone())?;
    let Some(config) = config else {
        response.hybrid_available = false;
        response.hybrid_reason =
            "Hybrid search needs an explicit OpenAI-compatible embedding profile.".to_string();
        return Ok(response);
    };
    if request.query.trim().is_empty() {
        response.hybrid_available = true;
        response.hybrid_reason = "Hybrid search needs a non-empty query.".to_string();
        return Ok(response);
    }
    if response.results.is_empty() {
        response.hybrid_available = true;
        response.hybrid_reason =
            "No lexical candidates were available for hybrid reranking.".to_string();
        return Ok(response);
    }
    let ids = response
        .results
        .iter()
        .map(|item| item.id.clone())
        .collect::<Vec<_>>();
    let vectors = store.embedded_chunks_for_documents(&ids, &config.model, config.dimensions)?;
    if vectors.is_empty() {
        response.hybrid_available = false;
        response.hybrid_reason =
            "No cached embeddings are available; run `promptops embed rebuild` first.".to_string();
        return Ok(response);
    }
    let query_vectors = request_embeddings(config, &[request.query]).await?;
    let Some(query_vector) = query_vectors.first() else {
        response.hybrid_available = false;
        response.hybrid_reason = "Embedding provider returned no query vector.".to_string();
        return Ok(response);
    };

    let mut semantic_by_doc = std::collections::HashMap::<String, f64>::new();
    for (document_id, vector) in vectors {
        let score = cosine(query_vector, &vector) as f64;
        semantic_by_doc
            .entry(document_id)
            .and_modify(|current| *current = current.max(score))
            .or_insert(score);
    }
    let mut semantic_rank = semantic_by_doc.iter().collect::<Vec<_>>();
    semantic_rank.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap_or(std::cmp::Ordering::Equal));
    let semantic_positions = semantic_rank
        .iter()
        .enumerate()
        .map(|(index, (id, _))| ((*id).clone(), index + 1))
        .collect::<std::collections::HashMap<_, _>>();

    for (lexical_index, item) in response.results.iter_mut().enumerate() {
        let lexical = 1.0 / (60.0 + lexical_index as f64 + 1.0);
        let semantic_rank = semantic_positions
            .get(&item.id)
            .copied()
            .unwrap_or(usize::MAX);
        let semantic = if semantic_rank == usize::MAX {
            0.0
        } else {
            1.0 / (60.0 + semantic_rank as f64)
        };
        item.semantic_score = semantic_by_doc.get(&item.id).copied();
        item.score = lexical + semantic;
    }
    response.results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    response.hybrid_available = true;
    response.hybrid_reason =
        "FTS and cached embeddings were merged with reciprocal rank fusion.".to_string();
    Ok(response)
}

async fn request_embeddings(config: &EmbedConfig, values: &[String]) -> Result<Vec<Vec<f32>>> {
    let client = embedding_client()?;
    let url = format!("{}/embeddings", config.base_url.trim_end_matches('/'));
    let mut request = client.post(url).json(&EmbeddingRequest {
        model: &config.model,
        input: values,
        dimensions: config.dimensions,
    });
    if let Some(api_key) = &config.api_key
        && !api_key.is_empty()
    {
        request = request.bearer_auth(api_key);
    }
    let response = request.send().await?.error_for_status()?;
    let payload = response.json::<EmbeddingResponse>().await?;
    Ok(payload
        .data
        .into_iter()
        .map(|datum| datum.embedding)
        .collect())
}

fn embedding_client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(30))
        .build()?)
}

fn cosine(left: &[f32], right: &[f32]) -> f32 {
    let len = left.len().min(right.len());
    if len == 0 {
        return 0.0;
    }
    let mut dot = 0.0;
    let mut left_norm = 0.0;
    let mut right_norm = 0.0;
    for index in 0..len {
        dot += left[index] * right[index];
        left_norm += left[index] * left[index];
        right_norm += right[index] * right[index];
    }
    if left_norm == 0.0 || right_norm == 0.0 {
        0.0
    } else {
        dot / (left_norm.sqrt() * right_norm.sqrt())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DocumentInput;
    use crate::models::SearchMode;
    use crate::paths::StatePaths;

    #[tokio::test]
    async fn no_profile_hybrid_search_preserves_lexical_response() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = Store::open(StatePaths {
            state_root: temp.path().join("state"),
            config_root: temp.path().join("config"),
            cache_root: temp.path().join("cache"),
            db_path: temp.path().join("state/promptops.sqlite"),
            raw_dir: temp.path().join("state/raw"),
            audit_log: temp.path().join("state/audit.jsonl"),
            config_file: temp.path().join("config/config.toml"),
        })
        .expect("store");
        store
            .upsert_document(DocumentInput {
                id: "prompt-1".to_string(),
                title: "Termination workflow".to_string(),
                kind: "canon".to_string(),
                status: "reviewed".to_string(),
                favorite: false,
                tags: vec!["agent".to_string()],
                risk_flags: Vec::new(),
                source_type: "test".to_string(),
                source_path: "/corpus/prompt-1.md".to_string(),
                source_record_id: None,
                corpus_root: Some("/corpus".to_string()),
                corpus_path: "canon/prompt-1.md".to_string(),
                content: "Design a termination-aware agent workflow.".to_string(),
                frontmatter: json!({}),
                imported_at: "2026-07-15T00:00:00Z".to_string(),
            })
            .expect("document");

        let response = hybrid_search(
            &store,
            SearchRequest {
                query: "termination".to_string(),
                mode: SearchMode::Hybrid,
                kind: Some("canon".to_string()),
                status: Some("reviewed".to_string()),
                tag: Some("agent".to_string()),
                risk: None,
                limit: 1,
            },
            None,
        )
        .await
        .expect("hybrid fallback");

        assert_eq!(response.mode, SearchMode::Hybrid);
        assert_eq!(response.query, "termination");
        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].id, "prompt-1");
        assert_eq!(response.facets.kinds[0].value, "canon");
        assert_eq!(response.stats.documents, 1);
        assert!(!response.hybrid_available);
        assert_eq!(
            response.hybrid_reason,
            "Hybrid search needs an explicit OpenAI-compatible embedding profile."
        );
    }
}
