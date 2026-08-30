import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const ORIGINAL_ENV = process.env.SARVAM_API_KEY;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  process.env.SARVAM_API_KEY = "test-key";
  vi.resetModules();
});

afterEach(() => {
  process.env.SARVAM_API_KEY = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

describe("chat()", () => {
  it("throws a typed 'truncated' error when finish_reason is length and content is null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ message: { content: null, reasoning_content: "still thinking..." }, finish_reason: "length" }],
        }),
      ),
    );

    const { chat } = await import("../lib/sarvam/client");
    const { SarvamError } = await import("../lib/sarvam/errors");

    const call = chat({ messages: [{ role: "user", content: "hi" }], maxTokens: 10 });
    await expect(call).rejects.toBeInstanceOf(SarvamError);
    await expect(call).rejects.toMatchObject({ kind: "truncated" });
  });

  it("returns content and reasoningContent on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ message: { content: "The answer is 4.", reasoning_content: "2+2=4" }, finish_reason: "stop" }],
        }),
      ),
    );

    const { chat } = await import("../lib/sarvam/client");
    const result = await chat({ messages: [{ role: "user", content: "what is 2+2" }] });

    expect(result.content).toBe("The answer is 4.");
    expect(result.reasoningContent).toBe("2+2=4");
    expect(result.finishReason).toBe("stop");
  });

  it("retries once on a 500 and succeeds on the second attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("server error", { status: 500 }))
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { chat } = await import("../lib/sarvam/client");
    const result = await chat({ messages: [{ role: "user", content: "hi" }] });

    expect(result.content).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry on a non-retryable 4xx and throws a typed http error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const { chat } = await import("../lib/sarvam/client");

    await expect(chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({ kind: "http", status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws a typed 'config' error when SARVAM_API_KEY is missing", async () => {
    delete process.env.SARVAM_API_KEY;
    const { chat } = await import("../lib/sarvam/client");

    await expect(chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({ kind: "config" });
  });
});

describe("json<T>()", () => {
  const schema = z.object({ answer: z.number() });

  it("parses and validates well-formed JSON on the first attempt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ choices: [{ message: { content: '{"answer": 42}' }, finish_reason: "stop" }] }),
      ),
    );

    const { json } = await import("../lib/sarvam/client");
    const result = await json(schema, { messages: [{ role: "user", content: "what is the answer" }] });
    expect(result).toEqual({ answer: 42 });
  });

  it("strips markdown code fences before parsing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ message: { content: '```json\n{"answer": 7}\n```' }, finish_reason: "stop" }],
        }),
      ),
    );

    const { json } = await import("../lib/sarvam/client");
    const result = await json(schema, { messages: [{ role: "user", content: "q" }] });
    expect(result).toEqual({ answer: 7 });
  });

  it("retries once with a repair prompt on malformed JSON, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "not json at all" }, finish_reason: "stop" }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '{"answer": 1}' }, finish_reason: "stop" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const { json } = await import("../lib/sarvam/client");
    const result = await json(schema, { messages: [{ role: "user", content: "q" }] });

    expect(result).toEqual({ answer: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondCallBody.messages.at(-1).content).toContain("not valid JSON");
  });

  it("throws a typed 'invalid-json' error after the repair attempt also fails", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        jsonResponse({ choices: [{ message: { content: "still not json" }, finish_reason: "stop" }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { json } = await import("../lib/sarvam/client");
    await expect(json(schema, { messages: [{ role: "user", content: "q" }] })).rejects.toMatchObject({
      kind: "invalid-json",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a typed 'invalid-schema' error when well-formed JSON never matches the schema", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        jsonResponse({ choices: [{ message: { content: '{"answer": "not a number"}' }, finish_reason: "stop" }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { json } = await import("../lib/sarvam/client");
    await expect(json(schema, { messages: [{ role: "user", content: "q" }] })).rejects.toMatchObject({
      kind: "invalid-schema",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries when JSON is valid but fails schema validation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '{"answer": "not a number"}' }, finish_reason: "stop" }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '{"answer": 9}' }, finish_reason: "stop" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const { json } = await import("../lib/sarvam/client");
    const result = await json(schema, { messages: [{ role: "user", content: "q" }] });
    expect(result).toEqual({ answer: 9 });
  });
});

describe("textToSpeech()", () => {
  it("decodes the base64 audio into a Buffer", async () => {
    const wavBase64 = Buffer.from("RIFF....fake-wav-bytes").toString("base64");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ audios: [wavBase64] })));

    const { textToSpeech } = await import("../lib/sarvam/client");
    const result = await textToSpeech({ text: "hello", speaker: "aditya" });

    expect(Buffer.isBuffer(result.audio)).toBe(true);
    expect(result.audio.toString("base64")).toBe(wavBase64);
  });

  it("throws a typed 'empty-content' error when no audio is returned", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ audios: [] })));

    const { textToSpeech } = await import("../lib/sarvam/client");
    await expect(textToSpeech({ text: "hello" })).rejects.toMatchObject({ kind: "empty-content" });
  });
});

describe("translate()", () => {
  it("returns the translated text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ translated_text: "नमस्ते" })));

    const { translate } = await import("../lib/sarvam/client");
    const result = await translate({ input: "Hello", sourceLanguageCode: "en-IN", targetLanguageCode: "hi-IN" });
    expect(result.translatedText).toBe("नमस्ते");
  });
});
