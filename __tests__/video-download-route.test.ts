import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getVideoJobStatus = vi.fn();
vi.mock("@/lib/video/jobs", () => ({ getVideoJobStatus: (id: string) => getVideoJobStatus(id) }));

const BODY = Buffer.from("0123456789abcdef");
let outputPath: string;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "video-download-"));
  outputPath = path.join(tmpDir, "lesson.mp4");
  fs.writeFileSync(outputPath, BODY);
  getVideoJobStatus.mockReset().mockReturnValue({ id: "job-1", status: "completed", outputPath });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function get(range?: string) {
  const req = new NextRequest("http://localhost/api/video/job-1/download", range ? { headers: { range } } : undefined);
  return import("../app/api/video/[jobId]/download/route").then(({ GET }) => GET(req, { params: Promise.resolve({ jobId: "job-1" }) }));
}

describe("GET /api/video/[jobId]/download", () => {
  it("serves the whole file and advertises range support when no Range header is sent", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-length")).toBe(String(BODY.length));
    expect(Buffer.from(await res.arrayBuffer())).toEqual(BODY);
  });

  it("answers a byte range with 206 and only those bytes, so the player can scrub", async () => {
    const res = await get("bytes=4-8");

    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 4-8/${BODY.length}`);
    expect(res.headers.get("content-length")).toBe("5");
    expect(await res.text()).toBe("456789abcdef".slice(0, 5));
  });

  it("treats an open-ended range as running to the end of the file", async () => {
    const res = await get("bytes=10-");

    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 10-15/${BODY.length}`);
    expect(await res.text()).toBe("abcdef");
  });

  it("reads a suffix range from the tail rather than the head", async () => {
    const res = await get("bytes=-4");

    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 12-15/${BODY.length}`);
    expect(await res.text()).toBe("cdef");
  });

  it("rejects a range past the end of the file instead of silently serving the whole thing", async () => {
    const res = await get("bytes=99-200");

    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${BODY.length}`);
  });
});
