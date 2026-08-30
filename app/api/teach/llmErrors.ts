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
 */
export type LlmOutcome<T> = { ok: true; value: T } | { ok: false; response: NextResponse };

export async function runLlm<T>(context: string, work: () => Promise<T>): Promise<LlmOutcome<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (err) {
    console.error(`${context} failed:`, err);
    const kind = isSarvamError(err) ? err.kind : "unknown";
    return {
      ok: false,
      response: NextResponse.json({ error: `${context} failed.`, kind }, { status: 502 }),
    };
  }
}
