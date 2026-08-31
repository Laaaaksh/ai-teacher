import { vi } from "vitest";

/** Not a *.test.ts file itself — a shared helper for mocking Sarvam chat completions in lib/teach tests. */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function chatCompletion(content: unknown): Response {
  return jsonResponse({
    choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }],
  });
}

/**
 * Stubs global fetch so every sarvam chat/json() call in order returns the
 * corresponding payload as the model's JSON content. Pass one payload per
 * expected call, in call order.
 */
export function stubChatSequence(...payloads: unknown[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  for (const payload of payloads) {
    fn.mockImplementationOnce(async () => chatCompletion(payload));
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}
