import { describe, expect, it, vi } from "vitest";

const speechToText = vi.fn();
vi.mock("@/lib/sarvam", () => ({ speechToText, isSarvamError: () => false }));

describe("POST /api/speech", () => {
  it("rejects an oversized upload from the declared length, before the body is buffered", async () => {
    const { POST } = await import("../app/api/speech/route");

    const res = await POST(
      new Request("http://localhost/api/speech", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(500 * 1024 * 1024) },
        body: JSON.stringify({ audio: "x" }),
      }) as never,
    );

    // 413 rather than the 400 a parsed-then-rejected body would produce.
    expect(res.status).toBe(413);
    expect(speechToText).not.toHaveBeenCalled();
  });

  it("rejects a multipart form with no audio field", async () => {
    const { POST } = await import("../app/api/speech/route");

    const form = new FormData();
    form.set("notaudio", "x");
    const res = await POST(new Request("http://localhost/api/speech", { method: "POST", body: form }) as never);

    expect(res.status).toBe(400);
    expect(speechToText).not.toHaveBeenCalled();
  });
});
