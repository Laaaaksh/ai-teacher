import { NextResponse } from "next/server";
import { isSarvamError } from "@/lib/sarvam";

/**
 * Every teaching-engine route runs at least one Sarvam call, and a timeout,
 * a 429 or a response that still doesn't match the schema after the client's
 * repair round is an ordinary upstream failure — not a bug in this route. So
 * it becomes a typed 502 the caller can branch on rather than an unhandled
 * 500 with no body.
 *
 * Returning a discriminated result instead of throwing keeps the route in
 * control of what has already been persisted when the failure lands.
 *
 * It also bounds how long the caller waits on any ONE such ask. A single
 * structured ask can internally become several attempts (lib/teach/llm.ts's
 * outer retry x lib/sarvam's repair round x sarvamPost's HTTP retry), each
 * carrying the 90s default timeout, so without a deadline a pathological
 * upstream ties up the caller for many minutes. The deadline is per call,
 * not per request: a route that chains asks (answer: evaluate then adapt;
 * assess/submit: one per answer) can spend a multiple of it, which is
 * deliberate — each ask is separately useful work, not a stalled retry.
 *
 * On expiry the caller gets a 504 immediately and the in-flight work is
 * abandoned, not awaited — so the raced work must not write. Where planning
 * is concerned that is why app/api/teach/sessions/route.ts races only the
 * model call and persists afterwards, rather than racing a function that
 * commits rows.
 */
export type LlmOutcome<T> = { ok: true; value: T } | { ok: false; response: NextResponse };

/** Two full lib/teach/llm.ts attempts' worth of headroom, and no more. */
export const DEFAULT_LLM_DEADLINE_MS = 180_000;

const DEADLINE = Symbol("llm-deadline");

export async function runLlm<T>(
  context: string,
  work: () => Promise<T>,
  opts?: { deadlineMs?: number },
): Promise<LlmOutcome<T>> {
  const deadlineMs = opts?.deadlineMs ?? DEFAULT_LLM_DEADLINE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const deadline = new Promise<typeof DEADLINE>((resolve) => {
      timer = setTimeout(() => resolve(DEADLINE), deadlineMs);
    });

    const result = await Promise.race([work(), deadline]);
    if (result === DEADLINE) {
      console.error(`${context} exceeded its ${deadlineMs}ms deadline.`);
      return {
        ok: false,
        response: NextResponse.json({ error: `${context} timed out.`, kind: "deadline-exceeded" }, { status: 504 }),
      };
    }
    return { ok: true, value: result as T };
  } catch (err) {
    console.error(`${context} failed:`, err);
    const kind = isSarvamError(err) ? err.kind : "unknown";
    return {
      ok: false,
      response: NextResponse.json({ error: `${context} failed.`, kind }, { status: 502 }),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
