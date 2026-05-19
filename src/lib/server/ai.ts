import { createOpenAI } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  embedMany,
  generateText,
  streamText,
  type UIMessage,
} from "ai";

import {
  candidateChunks,
  currentEmbeddingModel,
  decodeEmbedding,
  getPromptContent,
  searchDocuments,
  storeEmbedding,
} from "@/lib/server/db";
import { openAiModel, repoOpenAiKey } from "@/lib/server/env";
import type {
  EvalCase,
  EvalResult,
  PromptDetail,
  PromptSummary,
} from "@/lib/shared/types";

export type HybridResult = {
  results: PromptSummary[];
  available: boolean;
  reason: string;
};

export function openaiProvider() {
  const apiKey = repoOpenAiKey();
  if (!apiKey) {
    return null;
  }
  return createOpenAI({ apiKey });
}

export async function hybridSearch(input: {
  query: string;
  kind?: string;
  status?: string;
  tag?: string;
  limit: number;
}): Promise<HybridResult> {
  const lexical = searchDocuments({
    ...input,
    mode: "lexical",
    limit: Math.max(input.limit, 40),
  });
  const provider = openaiProvider();
  if (!provider) {
    return {
      results: lexical.slice(0, input.limit),
      available: false,
      reason: "Repo-scoped PROMPTBAR_OPENAI_API_KEY is not configured.",
    };
  }
  if (!input.query.trim() || !lexical.length) {
    return {
      results: lexical.slice(0, input.limit),
      available: true,
      reason: "Hybrid search needs a non-empty query and lexical candidates.",
    };
  }

  const model = currentEmbeddingModel();
  const chunks = candidateChunks(lexical.map((item) => item.id));
  const missing = chunks.filter(
    (chunk) => !chunk.embedding || chunk.embeddingModel !== model,
  );
  if (missing.length) {
    const { embeddings } = await embedMany({
      model: provider.embedding(model),
      values: missing.map((chunk) => chunk.content),
    });
    for (const [index, embedding] of embeddings.entries()) {
      const chunk = missing[index];
      if (chunk) {
        storeEmbedding({ chunkId: chunk.id, model, vector: embedding });
      }
    }
  }

  const refreshed = candidateChunks(lexical.map((item) => item.id));
  const { embeddings } = await embedMany({
    model: provider.embedding(model),
    values: [input.query],
  });
  const queryEmbedding = embeddings[0];
  if (!queryEmbedding) {
    return {
      results: lexical.slice(0, input.limit),
      available: false,
      reason: "Embedding provider did not return a query vector.",
    };
  }

  const byDocument = new Map<string, number>();
  for (const chunk of refreshed) {
    if (!chunk.embedding) {
      continue;
    }
    const score = cosine(queryEmbedding, decodeEmbedding(chunk.embedding));
    byDocument.set(
      chunk.documentId,
      Math.max(score, byDocument.get(chunk.documentId) ?? -1),
    );
  }
  const reranked = lexical
    .map((item) => ({
      ...item,
      semanticScore: byDocument.get(item.id) ?? 0,
    }))
    .sort((a, b) => {
      const semantic = (b.semanticScore ?? 0) - (a.semanticScore ?? 0);
      return semantic || (b.score ?? 0) - (a.score ?? 0);
    })
    .slice(0, input.limit);

  return {
    results: reranked,
    available: true,
    reason: "FTS candidates were reranked with cached OpenAI embeddings.",
  };
}

export async function streamChat(input: {
  messages: UIMessage[];
  contextIds: string[];
}) {
  const provider = openaiProvider();
  if (!provider) {
    throw new Error("PROMPTBAR_OPENAI_API_KEY is not configured.");
  }
  const docs = getPromptContent(input.contextIds).slice(0, 8);
  const result = streamText({
    model: provider(openAiModel()),
    system: buildSystemPrompt(docs),
    messages: await convertToModelMessages(input.messages),
  });
  return result.toUIMessageStreamResponse();
}

export async function runEvalCase(input: {
  prompt: PromptDetail;
  testCase: EvalCase;
}): Promise<EvalResult> {
  const started = Date.now();
  const provider = openaiProvider();
  if (!provider) {
    const output = localEvalOutput(input.prompt, input.testCase);
    return {
      promptId: input.prompt.id,
      caseId: input.testCase.id,
      output,
      passed: countLocalPasses(output, input.testCase.assertions),
      failed: countLocalFailures(output, input.testCase.assertions),
      notes: "Local fallback: assertion strings were checked directly.",
      durationMs: Date.now() - started,
    };
  }
  const { text } = await generateText({
    model: provider(openAiModel()),
    system: input.prompt.content,
    prompt: input.testCase.input,
  });
  return {
    promptId: input.prompt.id,
    caseId: input.testCase.id,
    output: text,
    passed: countLocalPasses(text, input.testCase.assertions),
    failed: countLocalFailures(text, input.testCase.assertions),
    notes: "Model output checked against saved assertion strings.",
    durationMs: Date.now() - started,
  };
}

function buildSystemPrompt(docs: PromptDetail[]): string {
  const context = docs
    .map((doc, index) => {
      const body = doc.content.slice(0, 3000);
      return `[${index + 1}] ${doc.title}\n${body}`;
    })
    .join("\n\n---\n\n");
  return [
    "You are Promptbar, a local prompt workbench assistant.",
    "Use selected prompt context when it is relevant.",
    "Cite prompt titles or bracket numbers when drawing from context.",
    "Prefer concrete edits, organization suggestions, and eval ideas.",
    context ? `Selected prompt context:\n\n${context}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function localEvalOutput(prompt: PromptDetail, testCase: EvalCase): string {
  return [
    `Local eval for ${prompt.title}`,
    "",
    "API generation is disabled because this repo has no",
    "PROMPTBAR_OPENAI_API_KEY in its local environment.",
    "",
    `Input: ${testCase.input}`,
    "",
    prompt.content.slice(0, 1200),
  ].join("\n");
}

function countLocalPasses(output: string, assertions: string[]): number {
  if (!assertions.length) {
    return 1;
  }
  const lower = output.toLowerCase();
  return assertions.filter((item) => lower.includes(item.toLowerCase())).length;
}

function countLocalFailures(output: string, assertions: string[]): number {
  return Math.max(0, assertions.length - countLocalPasses(output, assertions));
}

function cosine(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let index = 0; index < length; index += 1) {
    const av = a[index] ?? 0;
    const bv = b[index] ?? 0;
    dot += av * bv;
    aMag += av * av;
    bMag += bv * bv;
  }
  if (!aMag || !bMag) {
    return 0;
  }
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}
