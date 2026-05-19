import { describe, expect, it } from "vitest";

import {
  codexRequestSchema,
  evalRunRequestSchema,
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
});
