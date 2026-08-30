/**
 * Every lib/teach module's structured LLM call routes through this wrapper
 * instead of lib/sarvam's `json()` directly, so the token budget fix below
 * lives in one place.
 *
 * sarvam-105b is a reasoning model that writes `reasoning_content` before
 * `content`; verified live against the real API during this build, it can
 * truncate (`finish_reason: "length"`, no content) under lib/sarvam's
 * default 4096-token budget even for a small schema — how much it "thinks"
 * before answering varies by prompt, not just by output size, so raising
 * the default per-call in lib/sarvam wouldn't be a safe assumption for
 * every caller. The teaching engine's own default is set generously higher
 * here instead — and with it, a single call can genuinely take longer than
 * lib/sarvam's default 30s timeout (also verified live), so this also
 * raises that default per-call rather than per-request in lib/sarvam.
 */
import { json as sarvamJson } from "../sarvam";
import type { ChatMessage } from "../sarvam";
import type { z } from "zod";

const TEACH_DEFAULT_MAX_TOKENS = 8000;
const TEACH_DEFAULT_TIMEOUT_MS = 60_000;

export interface TeachJsonRequest {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export function json<T>(schema: z.ZodType<T>, req: TeachJsonRequest): Promise<T> {
  return sarvamJson(schema, {
    ...req,
    maxTokens: req.maxTokens ?? TEACH_DEFAULT_MAX_TOKENS,
    timeoutMs: req.timeoutMs ?? TEACH_DEFAULT_TIMEOUT_MS,
  });
}
