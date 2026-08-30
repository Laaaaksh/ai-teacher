import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  completeLessonSession,
  createAssessmentReport,
  getConceptProgressForLearner,
  getLearnerProfile,
  getLessonPlanForSession,
  getLessonSession,
  getQuestion,
  recordStudentAnswer,
  upsertConceptProgress,
} from "@/lib/db";
import { deriveMastery, generateAssessmentReport, type ConceptResult } from "@/lib/teach/assess";
import { evaluateAnswer } from "@/lib/teach/evaluate";

export const runtime = "nodejs";

const SubmitSchema = z.object({
  answers: z.array(z.object({ questionId: z.string().min(1), studentAnswer: z.string().min(1).max(5000) })).min(1),
});

/**
 * "Continue" (part 2) — grades the final quiz and produces the learning
 * report: score, concepts understood, weak areas, misconceptions still
 * held, recommended revision, next topic. Persists the report and marks
 * the session completed, so a later session for this learner is
 * personalised by what actually happened here (lib/db concept_progress).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const body = await req.json().catch(() => undefined);
  const parsed = SubmitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", issues: parsed.error.issues }, { status: 400 });
  }

  const session = getLessonSession(sessionId);
  if (!session) return NextResponse.json({ error: `Lesson session ${sessionId} not found.` }, { status: 404 });

  const plan = getLessonPlanForSession(sessionId);
  if (!plan) return NextResponse.json({ error: `No lesson plan for session ${sessionId}.` }, { status: 404 });

  const learnerProfile = getLearnerProfile(session.learnerProfileId)!;

  const quizResults: ConceptResult[] = [];
  for (const { questionId, studentAnswer } of parsed.data.answers) {
    const question = getQuestion(questionId);
    const concept = question ? plan.concepts.find((c) => c.id === question.conceptId) : undefined;
    if (!question || !concept) continue;

    const evaluation = await evaluateAnswer({ question, concept, studentAnswer, language: session.language });

    recordStudentAnswer({
      questionId: question.id,
      lessonSessionId: sessionId,
      studentAnswer: evaluation.studentAnswer,
      verdict: evaluation.verdict,
      misconception: evaluation.misconception,
      feedback: evaluation.feedback,
      difficultyAdjustment: evaluation.difficultyAdjustment,
    });

    const points = { correct: 100, partial: 50, incorrect: 0 }[evaluation.verdict];
    const existing = getConceptProgressForLearner(learnerProfile.id).find((p) => p.conceptId === concept.id);
    const masteryScore = existing ? Math.round(existing.masteryScore * 0.5 + points * 0.5) : points;
    upsertConceptProgress({
      learnerProfileId: learnerProfile.id,
      conceptId: concept.id,
      conceptTitle: concept.title,
      mastery: deriveMastery(masteryScore),
      masteryScore,
    });

    quizResults.push({ conceptId: concept.id, conceptTitle: concept.title, verdict: evaluation.verdict, misconception: evaluation.misconception });
  }

  if (quizResults.length === 0) {
    return NextResponse.json({ error: "None of the submitted questionIds belong to this session's lesson plan." }, { status: 400 });
  }

  const draftReport = await generateAssessmentReport({
    lessonSessionId: sessionId,
    topic: session.topic,
    concepts: plan.concepts,
    quizResults,
    learnerProfile,
    language: session.language,
  });

  const report = createAssessmentReport(draftReport);
  const completedSession = completeLessonSession(sessionId, "completed");

  return NextResponse.json({ report, session: completedSession });
}
