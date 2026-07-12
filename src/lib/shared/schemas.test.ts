import { describe, expect, it } from "vitest";

import {
  codexRequestSchema,
  evalRunRequestSchema,
  refinementRequestSchema,
  refinementResponseSchema,
  searchRequestSchema,
} from "./schemas";

describe("request schemas", () => {
  it("defaults search to lexical mode with bounded limits", () => {
    const parsed = searchRequestSchema.parse({ q: "react hooks" });
    expect(parsed).toMatchObject({
      q: "react hooks",
      mode: "lexical",
      limit: 30,
    });
  });

  it("rejects empty eval matrices", () => {
    expect(() =>
      evalRunRequestSchema.parse({ promptIds: [], cases: [] }),
    ).toThrow();
  });

  it("accepts explicit Codex bridge tasks with bounded context ids", () => {
    const parsed = codexRequestSchema.parse({
      promptIds: ["a", "b"],
      task: "Review selected prompts.",
    });
    expect(parsed.promptIds).toHaveLength(2);
  });

  it("trims valid cited-refinement requests and responses", () => {
    expect(
      refinementRequestSchema.parse({
        promptIds: [" first ", "second"],
        instruction: " Combine their strongest parts. ",
      }),
    ).toEqual({
      promptIds: ["first", "second"],
      instruction: "Combine their strongest parts.",
    });
    expect(
      refinementResponseSchema.parse({
        promptMarkdown: " # Refined prompt ",
        citations: [{ promptId: " first ", title: " First prompt " }],
      }),
    ).toEqual({
      promptMarkdown: "# Refined prompt",
      citations: [{ promptId: "first", title: "First prompt" }],
    });
  });

  it.each([
    { promptIds: [], instruction: "Refine" },
    { promptIds: ["a", " a "], instruction: "Refine" },
    {
      promptIds: Array.from({ length: 9 }, (_, index) => `${index}`),
      instruction: "Refine",
    },
    { promptIds: ["a"], instruction: " " },
    { promptIds: ["a"], instruction: "x".repeat(4001) },
    { promptIds: ["a"], instruction: "Refine", extra: true },
  ])("rejects invalid cited-refinement request %#", (request) => {
    expect(refinementRequestSchema.safeParse(request).success).toBe(false);
  });

  it.each([
    { promptMarkdown: "", citations: [{ promptId: "a", title: "A" }] },
    {
      promptMarkdown: "x".repeat(20_001),
      citations: [{ promptId: "a", title: "A" }],
    },
    { promptMarkdown: "Refined", citations: [] },
    {
      promptMarkdown: "Refined",
      citations: Array.from({ length: 9 }, (_, index) => ({
        promptId: `${index}`,
        title: `Prompt ${index}`,
      })),
    },
    {
      promptMarkdown: "Refined",
      citations: [{ promptId: " ", title: "A" }],
    },
    {
      promptMarkdown: "Refined",
      citations: [{ promptId: "a", title: " " }],
    },
    {
      promptMarkdown: "Refined",
      citations: [{ promptId: "a", title: "A", extra: true }],
    },
    {
      promptMarkdown: "Refined",
      citations: [{ promptId: "a", title: "A" }],
      extra: true,
    },
  ])("rejects invalid cited-refinement response %#", (response) => {
    expect(refinementResponseSchema.safeParse(response).success).toBe(false);
  });
});
