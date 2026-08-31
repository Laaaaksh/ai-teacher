import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  advanceLessonSessionScene,
  getAdaptationStatesForSession,
  getLessonPlanForSession,
  getLessonSession,
  getScenesForLessonPlan,
  getStudentAnswersForSession,
} from "@/lib/db";

export const runtime = "nodejs";

/**
 * Everything the lesson player needs to render/resume this session: the
 * session row (including `scriptingStatus`, the field to poll after
 * POST /api/teach/sessions returns), its plan, whatever scenes have been
 * scripted so far, prior answers and adaptation state.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = getLessonSession(id);
  if (!session) {
    return NextResponse.json({ error: `Lesson session ${id} not found.` }, { status: 404 });
  }

  const plan = getLessonPlanForSession(id);
  const scenes = plan ? getScenesForLessonPlan(plan.id) : [];
  const scriptedConceptCount = new Set(scenes.map((s) => s.conceptId)).size;

  return NextResponse.json({
    session,
    plan,
    scenes,
    scriptingProgress: { scriptedConcepts: scriptedConceptCount, totalConcepts: plan?.concepts.length ?? 0 },
    answers: getStudentAnswersForSession(id),
    adaptationState: getAdaptationStatesForSession(id),
  });
}

const PositionSchema = z.object({ currentSceneOrder: z.number().int().min(0) });

/**
 * The lesson player reports which beat the student is actually on. Without
 * it `current_scene_order` stays at 0 and every mid-lesson question
 * (`POST /sessions/[id]/ask`) is answered against the first concept no
 * matter how far in the student is.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getLessonSession(id)) {
    return NextResponse.json({ error: `Lesson session ${id} not found.` }, { status: 404 });
  }

  const body = await req.json().catch(() => undefined);
  const parsed = PositionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", issues: parsed.error.issues }, { status: 400 });
  }

  return NextResponse.json({ session: advanceLessonSessionScene(id, parsed.data.currentSceneOrder) });
}
