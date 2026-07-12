import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensurePromptopsStateReady: vi.fn(),
  generateRefinement: vi.fn(),
  getPrompt: vi.fn(),
  repoOpenAiKey: vi.fn(),
}));

vi.mock("../../../lib/server/ai", () => ({
  generateRefinement: mocks.generateRefinement,
}));
vi.mock("../../../lib/server/db", () => ({
  ensurePromptopsStateReady: mocks.ensurePromptopsStateReady,
  getPrompt: mocks.getPrompt,
}));
vi.mock("../../../lib/server/env", () => ({
  repoOpenAiKey: mocks.repoOpenAiKey,
}));

import { POST } from "./route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/refine", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/refine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.repoOpenAiKey.mockReturnValue("repo-key");
    mocks.ensurePromptopsStateReady.mockResolvedValue(undefined);
  });

  it.each([
    new Request("http://localhost/api/refine", { method: "POST", body: "{" }),
    request({ promptIds: [], instruction: "Refine" }),
    request({ promptIds: ["a"], instruction: "Refine", extra: true }),
  ])("returns 400 for malformed or invalid request data", async (input) => {
    const response = await POST(input);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request." });
    expect(mocks.ensurePromptopsStateReady).not.toHaveBeenCalled();
    expect(mocks.generateRefinement).not.toHaveBeenCalled();
  });

  it("returns the exact repo-key error before promptops or the model", async () => {
    mocks.repoOpenAiKey.mockReturnValue(null);

    const response = await POST(
      request({ promptIds: ["a"], instruction: "Refine" }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "PROMPTBAR_OPENAI_API_KEY is not configured.",
    });
    expect(mocks.ensurePromptopsStateReady).not.toHaveBeenCalled();
    expect(mocks.getPrompt).not.toHaveBeenCalled();
    expect(mocks.generateRefinement).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing selected prompt before generation", async () => {
    mocks.getPrompt
      .mockReturnValueOnce({ id: "a", title: "A", content: "redacted A" })
      .mockReturnValueOnce(null);

    const response = await POST(
      request({ promptIds: ["a", "b"], instruction: "Refine" }),
    );

    expect(response.status).toBe(404);
    expect(mocks.getPrompt.mock.calls).toEqual([
      ["a", { includeRaw: false }],
      ["b", { includeRaw: false }],
    ]);
    expect(mocks.generateRefinement).not.toHaveBeenCalled();
  });

  it("loads redacted prompts in order and passes only model-safe fields", async () => {
    mocks.getPrompt
      .mockReturnValueOnce({
        id: "a",
        title: "A",
        content: "redacted A",
        rawContent: "raw A",
        sourcePath: "/private/a.md",
      })
      .mockReturnValueOnce({
        id: "b",
        title: "B",
        content: "redacted B",
        rawContent: "raw B",
        sourcePath: "/private/b.md",
      });
    mocks.generateRefinement.mockResolvedValue({
      promptMarkdown: "# Refined",
      citations: [{ promptId: "b", title: "B" }],
    });

    const response = await POST(
      request({
        promptIds: [" a ", "b"],
        instruction: " Combine them. ",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      promptMarkdown: "# Refined",
      citations: [{ promptId: "b", title: "B" }],
    });
    expect(mocks.getPrompt.mock.calls).toEqual([
      ["a", { includeRaw: false }],
      ["b", { includeRaw: false }],
    ]);
    expect(mocks.generateRefinement).toHaveBeenCalledWith({
      instruction: "Combine them.",
      prompts: [
        { id: "a", title: "A", content: "redacted A" },
        { id: "b", title: "B", content: "redacted B" },
      ],
    });
  });

  it.each([
    () => Promise.reject(new Error("provider detail")),
    () => Promise.resolve({ promptMarkdown: "", citations: [] }),
  ])(
    "returns a generic 502 for generation or output failure",
    async (result) => {
      mocks.getPrompt.mockReturnValue({
        id: "a",
        title: "A",
        content: "redacted A",
      });
      mocks.generateRefinement.mockReturnValue(result());

      const response = await POST(
        request({ promptIds: ["a"], instruction: "Refine" }),
      );

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        error: "Unable to generate refinement.",
      });
    },
  );
});
