import { SarvamError } from "./errors";

export const SARVAM_BASE_URL = "https://api.sarvam.ai";

export const CHAT_MODEL = "sarvam-105b";
export const TTS_MODEL = "bulbul:v3";

/**
 * sarvam-105b writes `reasoning_content` before `content`. A tight
 * max_tokens budget gets consumed by reasoning and returns
 * `finish_reason: "length"` with `content: null` before any real answer is
 * written, so the default here is deliberately generous.
 */
export const DEFAULT_MAX_TOKENS = 4096;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_RETRIES = 1;
export const RETRY_BASE_DELAY_MS = 500;

export function getApiKey(): string {
  const key = process.env.SARVAM_API_KEY;
  if (!key) {
    throw new SarvamError("config", "SARVAM_API_KEY is not set. Copy .env.example to .env.local and fill it in.");
  }
  return key;
}
