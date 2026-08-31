import { NextRequest, NextResponse } from "next/server";
import { getAdaptationStatesForSession, getLessonPlanForSession, getLessonSession, getScenesForLessonPlan, getStudentAnswersForSession } from "@/lib/db";

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
