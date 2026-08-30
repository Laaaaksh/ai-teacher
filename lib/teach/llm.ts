/**
 * Every lib/teach module's structured LLM call routes through this wrapper
 * instead of lib/sarvam's `json()` directly. Two things live here:
 *
 * 1. A bounded outer retry on a malformed/truncated response. lib/sarvam's
 *    `json()` already retries once internally with a repair prompt; this
 *    adds one more full fresh attempt (so at most 2 outer x up to 2 inner =
 *    4 real model calls) ONLY for the response-shape errors a retry can
 *    plausibly fix (`truncated`, `invalid-json`, `invalid-schema`) — never
 *    for `config`/`network`/`http`/`timeout`, which a same-request retry
 *    won't help and would just add latency. The root cause of these errors
 *    was too small a `max_tokens` budget (fixed in lib/sarvam/config.ts,
 *    verified live: 4/4 succeeded vs 1/4 before); this retry is a safety
 *    net for a genuinely bad response, not the primary fix.
 * 2. lib/sarvam's defaults (`DEFAULT_MAX_TOKENS`, `DEFAULT_TIMEOUT_MS`)
 *    already cover the teaching engine's calls, so this no longer overrides
 *    either — callers only pass `maxTokens`/`timeoutMs` when a specific
 *    call needs more than the shared default.
 */
import { json as sarvamJson, isSarvamError } from "../sarvam";
import type { ChatMessage } from "../sarvam";
import type { z } from "zod";

export interface TeachJsonRequest {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

const RETRYABLE_KINDS = new Set(["truncated", "invalid-json", "invalid-schema"]);

export async function json<T>(schema: z.ZodType<T>, req: TeachJsonRequest): Promise<T> {
  try {
    return await sarvamJson(schema, req);
  } catch (err) {
    if (!isSarvamError(err) || !RETRYABLE_KINDS.has(err.kind)) throw err;
    return sarvamJson(schema, req);
  }
}
