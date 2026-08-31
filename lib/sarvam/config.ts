import { SarvamError } from "./errors";

export const SARVAM_BASE_URL = "https://api.sarvam.ai";

export const CHAT_MODEL = "sarvam-105b";
export const TTS_MODEL = "bulbul:v3";

/**
 * sarvam-105b writes `reasoning_content` before `content`, and `max_tokens`
 * covers BOTH. Measured live against the real API on a heavy structured
 * prompt: reasoning alone ran 26,000-34,000 characters (roughly 6,500-8,500
 * tokens) — so a call with `max_tokens: 8000` returned `finish_reason:
 * "length"` with content EMPTY three times out of four. Reasoning length is
 * prompt-driven, not budget-driven or controllable: `reasoning_effort`,
 * `reasoning.effort`, `thinking: false` and `max_reasoning_tokens` were all
 * tested live and are silently ignored (one even produced MORE reasoning
 * than the baseline). The only real lever on this axis is budgeting well
 * clear of the reasoning cost; the other lever — asking for less per call —
 * is each caller's responsibility (split a large structured ask into
 * several smaller ones rather than raising this further). Re-verified at
 * this value: 4/4 succeeded, avg ~47s.
 */
export const DEFAULT_MAX_TOKENS = 28_000;
export const DEFAULT_TIMEOUT_MS = 90_000;
export const DEFAULT_RETRIES = 1;
export const RETRY_BASE_DELAY_MS = 500;

export function getApiKey(): string {
  const key = process.env.SARVAM_API_KEY;
  if (!key) {
    throw new SarvamError("config", "SARVAM_API_KEY is not set. Copy .env.example to .env.local and fill it in.");
  }
  return key;
}
