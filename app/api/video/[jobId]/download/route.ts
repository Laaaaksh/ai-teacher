import fs from "node:fs";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { getVideoJobStatus } from "@/lib/video/jobs";

export const runtime = "nodejs";

/** Streams the rendered MP4 from disk rather than buffering it — a 20-minute lesson's output can run into the hundreds of MB, and this route must not hold that in memory. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
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
  const stream = Readable.toWeb(fs.createReadStream(job.outputPath)) as ReadableStream<Uint8Array>;

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="lesson-${jobId}.mp4"`,
    },
  });
}
