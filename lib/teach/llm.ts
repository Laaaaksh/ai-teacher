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
 *    won't help and would just add latency, and never for
 *    `invalid-response-body`, where Sarvam already processed (and billed)
 *    the request and only the gateway's reply was garbage. The root cause
 *    of these errors was too small a `max_tokens` budget (fixed in
 *    lib/sarvam/config.ts, verified live: 4/4 succeeded vs 1/4 before);
 *    this retry is a safety net for a genuinely bad response, not the
 *    primary fix.
 * 2. A wall-clock budget that decides whether the retry is still worth
 *    starting. Retrying multiplies attempts, and each attempt carries
 *    lib/sarvam's 90s timeout, its repair round and its own one HTTP retry,
 *    so an unbudgeted retry could keep a single structured ask alive for
 *    many minutes. This is a brake, not a hard ceiling: it skips the retry
 *    once the budget is nearly spent and shortens the retry's per-request
 *    timeout to what's left, but an attempt already in flight runs to its
 *    own completion — nothing here cancels it, so a retry whose repair
 *    round times out twice can still overshoot. Request-path callers get a
 *    real ceiling from `runLlm()` in app/api/teach/llmErrors.ts; this brake
 *    also covers background scripting, which has no HTTP caller at all.
 *
 * lib/sarvam's defaults (`DEFAULT_MAX_TOKENS`, `DEFAULT_TIMEOUT_MS`) already
 * cover the teaching engine's calls, so this doesn't override either —
 * callers only pass `maxTokens`/`timeoutMs` when a specific call needs
 * something other than the shared default.
 */
import { json as sarvamJson, isSarvamError, DEFAULT_TIMEOUT_MS } from "../sarvam";
import type { ChatMessage } from "../sarvam";
import type { z } from "zod";

export interface TeachJsonRequest {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

const RETRYABLE_KINDS = new Set(["truncated", "invalid-json", "invalid-schema"]);

/** How long a structured ask may already have run before a second full attempt stops being worth starting. */
const RETRY_BUDGET_MS = 150_000;

/** Below this much remaining budget a retry can't plausibly finish, so it isn't started. */
const MIN_RETRY_BUDGET_MS = 15_000;

export async function json<T>(schema: z.ZodType<T>, req: TeachJsonRequest): Promise<T> {
  const startedAt = Date.now();
  try {
    return await sarvamJson(schema, req);
  } catch (err) {
    if (!isSarvamError(err) || !RETRYABLE_KINDS.has(err.kind)) throw err;

    const remainingMs = RETRY_BUDGET_MS - (Date.now() - startedAt);
    if (remainingMs < MIN_RETRY_BUDGET_MS) throw err;

    return sarvamJson(schema, {
      ...req,
      timeoutMs: Math.min(req.timeoutMs ?? DEFAULT_TIMEOUT_MS, remainingMs),
    });
  }
}
