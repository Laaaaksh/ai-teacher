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
});

/** Kicks off a teaching-video render for an existing lesson plan and returns a job id to poll (GET /api/video/:jobId) and download (GET /api/video/:jobId/download) once complete. */
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

  const job = startVideoJob(parsed.data.lessonPlanId, parsed.data.personaId);
  return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
}
