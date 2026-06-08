import { createOpenAI } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  generateText,
  streamText,
  type UIMessage,
} from "ai";

import { getPromptContent } from "@/lib/server/db";
import { openAiModel, repoOpenAiKey } from "@/lib/server/env";
import type { EvalCase, EvalResult, PromptDetail } from "@/lib/shared/types";

export function openaiProvider() {
  const apiKey = repoOpenAiKey();
  if (!apiKey) {
    return null;
  }
  return createOpenAI({ apiKey });
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
