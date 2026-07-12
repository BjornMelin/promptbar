import { z } from "zod";

export const promptStatusSchema = z.enum([
  "inbox",
  "reviewed",
  "curate",
  "promote",
  "archived",
  "redact",
]);

/** Enumerates the supported modes for canonical search requests. */
export const searchModeSchema = z.enum(["lexical", "hybrid"]);

/** Validates an import request that may override the corpus root. */
export const importRequestSchema = z.object({
  root: z.string().min(1).optional(),
});

/** Validates search API parameters and applies their request defaults. */
export const searchRequestSchema = z.object({
  q: z.string().optional().default(""),
  mode: searchModeSchema.optional().default("lexical"),
  kind: z.string().optional(),
  status: promptStatusSchema.optional(),
  tag: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(80).optional().default(30),
});

export const promptPatchSchema = z.object({
  title: z.string().min(1).max(180).optional(),
  content: z.string().min(1).optional(),
  status: promptStatusSchema.optional(),
  favorite: z.boolean().optional(),
  tags: z.array(z.string().min(1).max(80)).optional(),
  reason: z.string().max(180).optional(),
});

export const evalRunRequestSchema = z.object({
  promptIds: z.array(z.string().min(1)).min(1).max(8),
  cases: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        input: z.string(),
        assertions: z.array(z.string()).default([]),
      }),
    )
    .min(1)
    .max(8),
});

export const exportRequestSchema = z.object({
  promptIds: z.array(z.string().min(1)).min(1).max(80),
});

export const codexRequestSchema = z.object({
  promptIds: z.array(z.string().min(1)).max(8).default([]),
  task: z.string().min(1).max(4000),
});
