import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiEnabled: vi.fn(),
  codexAvailable: vi.fn(),
  runPromptopsJson: vi.fn(),
}));

vi.mock("../../../lib/server/env", () => ({
  apiEnabled: mocks.apiEnabled,
  codexAvailable: mocks.codexAvailable,
}));
vi.mock("../../../lib/server/promptops", () => ({
  runPromptopsJson: mocks.runPromptopsJson,
}));

import { GET } from "./route";

function promptopsSearchData() {
  return {
    mode: "lexical" as const,
    query: "termination",
    results: [
      {
        id: "prompt-1",
        title: "Design an agent workflow",
        kind: "canon",
        status: "reviewed",
        favorite: true,
        tags: ["agent"],
        risk_flags: ["network"],
        source_path: "/corpus/canon/agent.md",
        corpus_path: "canon/agent.md",
        excerpt: "Design a termination-aware workflow.",
        content_hash: "hash-1",
        updated_at: "2026-07-15T00:00:00Z",
        score: 4.5,
        semantic_score: null,
      },
    ],
    facets: {
      kinds: [{ value: "canon", count: 1 }],
      statuses: [{ value: "reviewed", count: 1 }],
      tags: [{ value: "agent", count: 1 }],
      risks: [{ value: "network", count: 1 }],
    },
    stats: {
      documents: 1,
      chunks: 2,
      favorites: 1,
      risks: 1,
      eval_runs: 3,
      embedded_chunks: 0,
      latest_import_at: "2026-07-15T00:00:00Z",
      default_import_root: "/corpus",
    },
    hybrid_available: false,
    hybrid_reason:
      "FTS search is authoritative; embeddings rerank when configured.",
  };
}

describe("GET /api/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiEnabled.mockReturnValue(true);
    mocks.codexAvailable.mockReturnValue(false);
  });

  it("routes lexical search and filters through promptops and adapts its response", async () => {
    mocks.runPromptopsJson.mockResolvedValue({
      schema: "promptops.output.v1",
      data: promptopsSearchData(),
    });

    const response = await GET(
      new Request(
        "http://localhost/api/search?q=termination&mode=lexical&kind=canon&status=reviewed&tag=-agent&limit=7",
      ),
    );

    expect(mocks.runPromptopsJson).toHaveBeenCalledOnce();
    expect(mocks.runPromptopsJson).toHaveBeenCalledWith([
      "search",
      "--mode=lexical",
      "--limit=7",
      "--kind=canon",
      "--status=reviewed",
      "--tag=-agent",
      "--",
      "termination",
    ]);
    expect(await response.json()).toEqual({
      mode: "lexical",
      query: "termination",
      results: [
        {
          id: "prompt-1",
          title: "Design an agent workflow",
          kind: "canon",
          status: "reviewed",
          favorite: true,
          tags: ["agent"],
          riskFlags: ["network"],
          sourcePath: "/corpus/canon/agent.md",
          corpusPath: "canon/agent.md",
          excerpt: "Design a termination-aware workflow.",
          contentHash: "hash-1",
          updatedAt: "2026-07-15T00:00:00Z",
          score: 4.5,
          semanticScore: null,
        },
      ],
      facets: {
        kinds: [{ value: "canon", count: 1 }],
        statuses: [{ value: "reviewed", count: 1 }],
        tags: [{ value: "agent", count: 1 }],
        risks: [{ value: "network", count: 1 }],
      },
      stats: {
        documents: 1,
        chunks: 2,
        favorites: 1,
        risks: 1,
        evalRuns: 3,
        embeddedChunks: 0,
        latestImportAt: "2026-07-15T00:00:00Z",
        apiEnabled: true,
        codexAvailable: false,
        defaultImportRoot: "/corpus",
      },
      hybridAvailable: false,
      hybridReason:
        "FTS search is authoritative; embeddings rerank when configured.",
    });
  });

  it("routes an empty no-key hybrid search through the same promptops boundary", async () => {
    mocks.runPromptopsJson.mockResolvedValue({
      schema: "promptops.output.v1",
      data: {
        ...promptopsSearchData(),
        mode: "hybrid",
        query: "",
        results: [],
        hybrid_reason:
          "Hybrid search needs an explicit OpenAI-compatible embedding profile.",
      },
    });

    const response = await GET(
      new Request("http://localhost/api/search?mode=hybrid"),
    );

    expect(mocks.runPromptopsJson).toHaveBeenCalledOnce();
    expect(mocks.runPromptopsJson).toHaveBeenCalledWith([
      "search",
      "--mode=hybrid",
      "--limit=30",
      "--",
      "",
    ]);
    expect(await response.json()).toMatchObject({
      mode: "hybrid",
      query: "",
      results: [],
      hybridAvailable: false,
      hybridReason:
        "Hybrid search needs an explicit OpenAI-compatible embedding profile.",
    });
  });
});
