import { NextRequest, NextResponse } from "next/server";
import { getVideoJobStatus } from "@/lib/video/jobs";

export const runtime = "nodejs";

/** Real progress, not a fake spinner: stage/percent/detail are written live by the render pipeline (lib/video/render.ts) as it narrates, renders, and muxes each scene. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getVideoJobStatus(jobId);
  if (!job) {
    return NextResponse.json({ error: `No video job found for id ${jobId}.` }, { status: 404 });
  }

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    progressPercent: job.progressPercent,
    stageDetail: job.stageDetail,
    errorMessage: job.errorMessage,
    downloadUrl: job.status === "completed" ? `/api/video/${job.id}/download` : null,
  });
}
