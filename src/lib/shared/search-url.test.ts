import { describe, expect, it } from "vitest";

import {
  DEFAULT_SEARCH_URL_STATE,
  parseSearchUrl,
  serializeSearchUrl,
  type SearchUrlState,
} from "./search-url";

describe("shareable search URLs", () => {
  it("requires the search view and omits every default", () => {
    expect(parseSearchUrl("?q=ignored")).toBeNull();
    expect(serializeSearchUrl(DEFAULT_SEARCH_URL_STATE)).toBe("?view=search");
  });

  it("round-trips special characters in a stable field order", () => {
    const state: SearchUrlState = {
      query: "C++ & /?#",
      mode: "hybrid",
      kind: "agent workflow",
      status: "reviewed",
      tag: "R&D + ops",
    };

    const serialized = serializeSearchUrl(state);
    expect(serialized).toBe(
      "?view=search&q=C%2B%2B+%26+%2F%3F%23&mode=hybrid&kind=agent+workflow&status=reviewed&tag=R%26D+%2B+ops",
    );
    expect(parseSearchUrl(serialized)).toEqual(state);
  });

  it.each([
    ["mode", "invalid", { mode: "lexical" }],
    ["status", "invalid", { status: null }],
    ["kind", "", { kind: null }],
    ["tag", "", { tag: null }],
  ] as const)(
    "falls back only the invalid %s field",
    (field, invalidValue, expectedFallback) => {
      const params = new URLSearchParams({
        view: "search",
        q: "termination",
        mode: "hybrid",
        kind: "canon",
        status: "reviewed",
        tag: "agent",
      });
      params.set(field, invalidValue);

      expect(parseSearchUrl(`?${params}`)).toMatchObject({
        query: "termination",
        mode: "hybrid",
        kind: "canon",
        status: "reviewed",
        tag: "agent",
        ...expectedFallback,
      });
    },
  );

  it("preserves legal all and whitespace facet values", () => {
    const state: SearchUrlState = {
      ...DEFAULT_SEARCH_URL_STATE,
      kind: " all ",
      tag: "all",
    };
    expect(parseSearchUrl(serializeSearchUrl(state))).toEqual(state);
  });

  it("drops unknown keys and scalar defaults when canonicalized", () => {
    const state = parseSearchUrl("?ignored=1&view=search&mode=lexical&q=");
    expect(state).not.toBeNull();
    expect(serializeSearchUrl(state!)).toBe("?view=search");
  });
});
