import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const model = {};
  const provider = vi.fn(() => model);
  return {
    createOpenAI: vi.fn(() => provider),
    generateText: vi.fn(),
    model,
    outputObject: vi.fn(),
    provider,
  };
});

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: mocks.createOpenAI }));
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  mocks.outputObject.mockImplementation(actual.Output.object);
  return {
    ...actual,
    generateText: mocks.generateText,
    Output: { ...actual.Output, object: mocks.outputObject },
  };
});
vi.mock("./db", () => ({ getPromptContent: vi.fn() }));

import { generateRefinement } from "./ai";

const prompts = [
  { id: "prompt-secret-one", title: "First", content: "redacted one" },
  { id: "prompt-secret-two", title: "Second", content: "redacted two" },
];

describe("generateRefinement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PROMPTBAR_OPENAI_API_KEY", "repo-key");
    vi.stubEnv("PROMPTBAR_OPENAI_MODEL", "test-model");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stops before the model when no repo-scoped provider is configured", async () => {
    vi.stubEnv("PROMPTBAR_OPENAI_API_KEY", "");

    await expect(
      generateRefinement({ instruction: "Combine them", prompts }),
    ).rejects.toThrow("PROMPTBAR_OPENAI_API_KEY is not configured.");
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("sends only numbered redacted content, bounded to 3000 characters", async () => {
    mocks.generateText.mockResolvedValue({
      output: { promptMarkdown: "# Refined", sourceIndexes: [1] },
    });
    const longContent = `${"x".repeat(3000)}not-transmitted`;
    const promptWithPrivateFields = {
      id: "prompt-secret-id",
      title: "Safe title",
      content: longContent,
      rawContent: "raw secret",
      sourcePath: "/private/source.md",
    };

    await generateRefinement({
      instruction: "Combine them",
      prompts: [promptWithPrivateFields],
    });

    const call = mocks.generateText.mock.calls[0]?.[0];
    expect(mocks.createOpenAI).toHaveBeenCalledWith({ apiKey: "repo-key" });
    expect(mocks.provider).toHaveBeenCalledWith("test-model");
    expect(call.model).toBe(mocks.model);
    const modelInput = `${call.system}\n${call.prompt}`;
    expect(modelInput).toContain(`[1] Safe title\n${"x".repeat(3000)}`);
    expect(modelInput).not.toContain("not-transmitted");
    expect(modelInput).not.toContain("prompt-secret-id");
    expect(modelInput).not.toContain("raw secret");
    expect(modelInput).not.toContain("/private/source.md");
    expect(mocks.outputObject).toHaveBeenCalledOnce();
    const outputSchema = mocks.outputObject.mock.calls[0]?.[0].schema;
    expect(
      outputSchema.safeParse({
        promptMarkdown: "# Refined",
        sourceIndexes: [1],
      }).success,
    ).toBe(true);
    expect(
      outputSchema.safeParse({
        promptMarkdown: "# Refined",
        sourceIndexes: [2],
      }).success,
    ).toBe(false);
  });

  it("maps and deduplicates model indexes in first-seen order", async () => {
    mocks.generateText.mockResolvedValue({
      output: { promptMarkdown: "# Refined", sourceIndexes: [2, 1, 2] },
    });

    await expect(
      generateRefinement({ instruction: "Combine them", prompts }),
    ).resolves.toEqual({
      promptMarkdown: "# Refined",
      citations: [
        { promptId: "prompt-secret-two", title: "Second" },
        { promptId: "prompt-secret-one", title: "First" },
      ],
    });
  });

  it("rejects an unresolved model citation", async () => {
    mocks.generateText.mockResolvedValue({
      output: { promptMarkdown: "# Refined", sourceIndexes: [3] },
    });

    await expect(
      generateRefinement({ instruction: "Combine them", prompts }),
    ).rejects.toThrow(
      "Generated citation did not resolve to a selected prompt.",
    );
  });
});
