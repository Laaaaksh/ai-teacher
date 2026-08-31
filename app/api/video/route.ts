import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getLessonPlan } from "@/lib/db";
import { TEACHER_PERSONAS } from "@/lib/video/avatar/personas";
import { startVideoJob } from "@/lib/video/jobs";

export const runtime = "nodejs";

const PERSONA_IDS = TEACHER_PERSONAS.map((p) => p.id) as [string, ...string[]];

const StartVideoJobSchema = z.object({
  lessonPlanId: z.string().min(1),
  personaId: z.enum(PERSONA_IDS).optional(),
  /**
   * Render only these scenes rather than the whole plan — the lesson player
   * renders one segment at a time (see docs/VIDEO.md) so it can pause for a
   * real checkpoint question instead of baking the whole multi-concept
   * lesson into one video up front.
   */
  sceneIds: z.array(z.string().min(1)).min(1).optional(),
  skipTitleCard: z.boolean().optional(),
});

/** Kicks off a teaching-video render for an existing lesson plan (or a subset of its scenes) and returns a job id to poll (GET /api/video/:jobId) and download (GET /api/video/:jobId/download) once complete. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => undefined);
  const parsed = StartVideoJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body.", issues: parsed.error.issues }, { status: 400 });
  }

  const plan = getLessonPlan(parsed.data.lessonPlanId);
  if (!plan) {
    return NextResponse.json({ error: `No lesson plan found for id ${parsed.data.lessonPlanId}.` }, { status: 404 });
  }

  const job = startVideoJob(parsed.data.lessonPlanId, {
    personaId: parsed.data.personaId,
    sceneIds: parsed.data.sceneIds,
    skipTitleCard: parsed.data.skipTitleCard,
  });
  return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
}
