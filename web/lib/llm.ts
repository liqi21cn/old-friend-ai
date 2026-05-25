import OpenAI from "openai";

export const LLM_BASE_URL =
  process.env.OPENAI_BASE_URL || "https://tokenhub.tencentmaas.com/v1";
export const LLM_MODEL = process.env.OPENAI_MODEL || "deepseek-v4-pro";

/**
 * Reasoning-token headroom added on top of every call site's intended output
 * budget. Reasoning models (Claude/o-series/gemini-pro-preview) eat hidden
 * "thinking" tokens before producing any visible content; on a tight
 * max_tokens we get back finish_reason="length" with empty content.
 *
 * Tunable: set OPENAI_REASONING_BUFFER in env to override.
 */
export const LLM_REASONING_BUFFER = Number(
  process.env.OPENAI_REASONING_BUFFER || 3000,
);

/**
 * Most reasoning models accept `reasoning_effort: "none" | "minimal" | "low"
 *  | "medium" | "high"` (the OpenAI o-series flag — gemini-pro-preview and
 * claude-on-yunwu both honor it). When set to "none", thinking is skipped
 * entirely; the buffer above is still applied as a safety net because some
 * providers still burn a small amount of hidden tokens even with effort=none.
 */
export const LLM_REASONING_EFFORT =
  process.env.OPENAI_REASONING_EFFORT || "none";

/**
 * Build the extra fields every chat.completions.create call should ship with
 * when we're talking to a reasoning model. Use spread at the call site:
 *
 *   client.chat.completions.create({
 *     model: LLM_MODEL,
 *     max_tokens: 800,
 *     ...llmReasoningExtras(800),
 *     ...
 *   })
 *
 * It bumps max_tokens by LLM_REASONING_BUFFER and adds reasoning_effort.
 */
export function llmReasoningExtras(intendedOutputTokens: number) {
  return {
    max_tokens: intendedOutputTokens + LLM_REASONING_BUFFER,
    reasoning_effort: LLM_REASONING_EFFORT,
  } as any;
}

export function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  return new OpenAI({ apiKey, baseURL: LLM_BASE_URL });
}
