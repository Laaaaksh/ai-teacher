import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createLearningPath, getLearnerProfile, getLearningPathsForLearner } from "@/lib/db";
import { generateLearningPath } from "@/lib/teach/path";

export const runtime = "nodejs";

const PathRequestSchema = z.object({
  learnerProfileId: z.string().min(1),
  topic: z.string().min(1).max(500),
  mode: z.enum(["broad-topic", "multi-day"]),
  totalSessions: z.number().int().min(1).max(60).optional(),
  minutesPerSession: z.number().int().min(1).max(600).optional(),
});

/**
 * For a broad topic ("teach me machine learning") or an explicit multi-day
 * request, an ordered LearningPathStep[] with the first step unlocked and
 * the rest locked. Each step's own LessonPlan is generated lazily via
 * POST /api/teach/sessions when the learner actually starts that step.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => undefined);
  const parsed = PathRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", issues: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;

  if (input.mode === "multi-day" && !input.totalSessions) {
    return NextResponse.json({ error: "totalSessions is required when mode is 'multi-day'." }, { status: 400 });
  }

  const learnerProfile = getLearnerProfile(input.learnerProfileId);
  if (!learnerProfile) {
    return NextResponse.json({ error: `Learner profile ${input.learnerProfileId} not found.` }, { status: 404 });
  }

  const drafts = await generateLearningPath({
    topic: input.topic,
    learnerProfile,
    mode: input.mode,
    totalSessions: input.totalSessions,
    minutesPerSession: input.minutesPerSession,
  });

  const path = createLearningPath({
    learnerProfileId: input.learnerProfileId,
    topic: input.topic,
    steps: drafts.map(({ id, order, title, conceptIds, status }) => ({ id, order, title, conceptIds, status })),
  });

  return NextResponse.json({ path, stepSummaries: drafts.map((d) => ({ id: d.id, summary: d.summary })) }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const learnerProfileId = req.nextUrl.searchParams.get("learnerProfileId");
  if (!learnerProfileId) {
    return NextResponse.json({ error: "learnerProfileId query param is required." }, { status: 400 });
  }
  return NextResponse.json({ paths: getLearningPathsForLearner(learnerProfileId) });
}
