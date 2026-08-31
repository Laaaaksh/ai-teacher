import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getLearnerProfile,
  getLessonPlanForSession,
  getLessonSession,
  getScenesForLessonPlan,
  updateLessonSessionLanguage,
} from "@/lib/db";
import { answerFollowUpQuestion } from "@/lib/teach/ask";
import { runLlm } from "../../../llmErrors";

export const runtime = "nodejs";

const AskSchema = z.object({ question: z.string().min(1).max(2000) });

/**
 * The student interrupts mid-lesson to ask anything. Answered grounded in
 * the source material/lesson (or a mid-lesson language switch is applied),
 * without touching `current_scene_order` — the lesson resumes exactly where
 * it was.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const body = await req.json().catch(() => undefined);
  const parsed = AskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", issues: parsed.error.issues }, { status: 400 });
  }

  const session = getLessonSession(sessionId);
  if (!session) return NextResponse.json({ error: `Lesson session ${sessionId} not found.` }, { status: 404 });

  const learnerProfile = getLearnerProfile(session.learnerProfileId)!;
  const plan = getLessonPlanForSession(sessionId);
  const currentScene = plan ? getScenesForLessonPlan(plan.id).find((s) => s.order === session.currentSceneOrder) : undefined;
  const currentConcept = plan?.concepts.find((c) => c.id === currentScene?.conceptId);

  const answered = await runLlm("Answering the follow-up question", () =>
    answerFollowUpQuestion({
      question: parsed.data.question,
      lessonTopic: session.topic,
      currentConcept: currentConcept ? { title: currentConcept.title, summary: currentConcept.summary } : undefined,
      sourceDocumentId: session.sourceDocumentId ?? undefined,
      language: session.language,
      learnerProfile,
    }),
  );
  if (!answered.ok) return answered.response;
  const result = answered.value;

  let updatedSession = session;
  if (result.languageSwitchRequested) {
    updatedSession = updateLessonSessionLanguage(sessionId, result.languageSwitchRequested);
  }

  return NextResponse.json({ ...result, session: updatedSession });
}
