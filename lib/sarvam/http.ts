import { SarvamError } from "./errors";
import { DEFAULT_RETRIES, DEFAULT_TIMEOUT_MS, RETRY_BASE_DELAY_MS, getApiKey } from "./config";

export interface RequestOptions {
  /** Full URL, e.g. `${SARVAM_BASE_URL}/v1/chat/completions`. */
  path: string;
  /** JSON body, or a pre-built FormData for multipart requests (STT). */
  body: unknown;
  timeoutMs?: number;
  retries?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * POSTs to a Sarvam endpoint with a timeout and one retry (default) on
 * 429/5xx with exponential backoff. Non-retryable HTTP errors and network
 * failures surface immediately as typed SarvamError instances — never a
 * silent empty result. A success whose body is not valid JSON is an
 * `invalid-response-body` error, not a retry: the server already processed
 * that request, so re-POSTing it would double-bill it. It deliberately does
 * NOT share `invalid-json` with an unparseable model *output*, which upper
 * layers do retry.
 */
export async function sarvamPost<TResponse = unknown>(opts: RequestOptions): Promise<TResponse> {
  const { path, body, timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES } = opts;
  const apiKey = getApiKey();
  const url = path;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  let lastError: SarvamError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: isFormData
          ? { "api-subscription-key": apiKey }
          : { "api-subscription-key": apiKey, "Content-Type": "application/json" },
        body: isFormData ? (body as FormData) : JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const httpError = new SarvamError(
          "http",
          `Sarvam request to ${path} failed with ${response.status}: ${text.slice(0, 500)}`,
          { status: response.status },
        );
        if (isRetryableStatus(response.status) && attempt < retries) {
          lastError = httpError;
          await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
          continue;
        }
        throw httpError;
      }

      const rawBody = await response.text();
      try {
        return JSON.parse(rawBody) as TResponse;
      } catch (parseErr) {
        throw new SarvamError(
          "invalid-response-body",
          `Sarvam request to ${path} returned HTTP ${response.status} but the body was not valid JSON: ${rawBody.slice(0, 500)}`,
          { cause: parseErr },
        );
      }
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof SarvamError) {
        throw err;
      }
      if (err instanceof Error && err.name === "AbortError") {
        const timeoutError = new SarvamError("timeout", `Sarvam request to ${path} timed out after ${timeoutMs}ms`);
        if (attempt < retries) {
          lastError = timeoutError;
          await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
          continue;
        }
        throw timeoutError;
      }
      const networkError = new SarvamError("network", `Sarvam request to ${path} failed: ${(err as Error).message}`, {
        cause: err,
      });
      if (attempt < retries) {
        lastError = networkError;
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw networkError;
    }
  }

  // Unreachable in practice: the loop always returns or throws. Kept for type safety.
  throw lastError ?? new SarvamError("network", `Sarvam request to ${path} failed with no response`);
}
