import { z, type ZodType } from "zod";

import { promptStatusSchema, searchModeSchema } from "./schemas";
import type { PromptStatus, SearchMode } from "./types";

const querySchema = z.string();
const facetSchema = z.string().min(1);

export type SearchUrlState = {
  query: string;
  mode: SearchMode;
  kind: string | null;
  status: PromptStatus | null;
  tag: string | null;
};

export const DEFAULT_SEARCH_URL_STATE: SearchUrlState = {
  query: "",
  mode: "lexical",
  kind: null,
  status: null,
  tag: null,
};

/**
 * Parses a shareable search URL without allowing one invalid field to erase
 * the other valid filters.
 */
export function parseSearchUrl(search: string): SearchUrlState | null {
  const params = new URLSearchParams(search);
  if (params.get("view") !== "search") {
    return null;
  }

  return {
    query: parseField(
      querySchema,
      params.get("q"),
      DEFAULT_SEARCH_URL_STATE.query,
    ),
    mode: parseField(
      searchModeSchema,
      params.get("mode"),
      DEFAULT_SEARCH_URL_STATE.mode,
    ),
    kind: parseField(
      facetSchema,
      params.get("kind"),
      DEFAULT_SEARCH_URL_STATE.kind,
    ),
    status: parseField(
      promptStatusSchema,
      params.get("status"),
      DEFAULT_SEARCH_URL_STATE.status,
    ),
    tag: parseField(
      facetSchema,
      params.get("tag"),
      DEFAULT_SEARCH_URL_STATE.tag,
    ),
  };
}

/** Serializes only public search state in one stable order. */
export function serializeSearchUrl(state: SearchUrlState): string {
  const params = new URLSearchParams();
  params.set("view", "search");
  if (state.query) {
    params.set("q", state.query);
  }
  if (state.mode !== DEFAULT_SEARCH_URL_STATE.mode) {
    params.set("mode", state.mode);
  }
  if (state.kind !== null) {
    params.set("kind", state.kind);
  }
  if (state.status !== null) {
    params.set("status", state.status);
  }
  if (state.tag !== null) {
    params.set("tag", state.tag);
  }
  return `?${params.toString()}`;
}

function parseField<T, F>(
  schema: ZodType<T>,
  value: string | null,
  fallback: F,
): T | F {
  if (value === null) {
    return fallback;
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}
