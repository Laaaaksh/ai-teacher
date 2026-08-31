import fs from "node:fs";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { getVideoJobStatus } from "@/lib/video/jobs";

export const runtime = "nodejs";

type ByteRange = { start: number; end: number };

/**
 * Parses a single-range `bytes=` header: a range, `"unsatisfiable"` when it is
 * well-formed but outside the file, or null for anything else (including
 * multi-range) so the caller just serves the whole file — browsers only ever
 * ask for one range when scrubbing.
 */
function parseByteRange(header: string, size: number): ByteRange | "unsatisfiable" | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  // A suffix range ("bytes=-500") asks for the last N bytes, not an offset.
  const start = rawStart === "" ? Math.max(0, size - Number(rawEnd)) : Number(rawStart);
  const end = rawStart === "" ? size - 1 : Math.min(rawEnd === "" ? size - 1 : Number(rawEnd), size - 1);

  if (start > end || start >= size) return "unsatisfiable";
  return { start, end };
}

/** Streams the rendered MP4 from disk rather than buffering it — output size grows without bound as lessons get longer, and this route must not hold a whole file in memory. Range requests are honoured so the student can scrub within a segment. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getVideoJobStatus(jobId);

  if (!job) {
    return NextResponse.json({ error: `No video job found for id ${jobId}.` }, { status: 404 });
  }
  if (job.status !== "completed" || !job.outputPath) {
    return NextResponse.json({ error: `Video job ${jobId} is not complete yet (status: ${job.status}).` }, { status: 409 });
  }
  if (!fs.existsSync(job.outputPath)) {
    return NextResponse.json({ error: `Rendered file for job ${jobId} is missing on disk.` }, { status: 410 });
  }

  const stat = fs.statSync(job.outputPath);
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Content-Disposition": `attachment; filename="lesson-${jobId}.mp4"`,
  };

  const rangeHeader = req.headers.get("range");
  if (rangeHeader) {
    const range = parseByteRange(rangeHeader, stat.size);
    if (range === "unsatisfiable") {
      return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${stat.size}` } });
    }
    if (range) {
      const stream = Readable.toWeb(fs.createReadStream(job.outputPath, { start: range.start, end: range.end })) as ReadableStream<Uint8Array>;
      return new NextResponse(stream, {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
          "Content-Length": String(range.end - range.start + 1),
        },
      });
    }
  }

  const stream = Readable.toWeb(fs.createReadStream(job.outputPath)) as ReadableStream<Uint8Array>;

  return new NextResponse(stream, {
    headers: { ...headers, "Content-Length": String(stat.size) },
  });
}
