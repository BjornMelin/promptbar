use serde::{Deserialize, Serialize};
use serde_json::json;

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
    let chunks = store.chunks_missing_embeddings(&config.model, limit)?;
    if chunks.is_empty() {
        return Ok(EmbedReport {
            model: config.model.clone(),
            embedded: 0,
            skipped: 0,
        });
    }
    let client = reqwest::Client::new();
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
    let vectors = store.embedded_chunks_for_documents(&ids, &config.model)?;
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
    let client = reqwest::Client::new();
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
