import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ listDocuments: () => [], saveDocument: vi.fn() }));

describe("POST /api/documents", () => {
  it("rejects a body that is not multipart with the 400 rather than a raw throw", async () => {
    const { POST } = await import("../app/api/documents/route");

    const res = await POST(
      new Request("http://localhost/api/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: "x" }),
      }) as never,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/multipart/);
  });

  it("rejects a multipart form with no file field", async () => {
    const { POST } = await import("../app/api/documents/route");

    const form = new FormData();
    form.set("notafile", "x");
    const res = await POST(
      new Request("http://localhost/api/documents", { method: "POST", body: form }) as never,
    );

    expect(res.status).toBe(400);
  });
});
