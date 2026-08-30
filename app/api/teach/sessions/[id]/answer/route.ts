import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createQuestion,
  createScene,
  getAdaptationState,
  getConceptProgressForLearner,
  getLearnerProfile,
  getLessonPlanForSession,
  getLessonSession,
  getQuestion,
  getScenesForLessonPlan,
  recordAdaptationAttempt,
  recordStudentAnswer,
  upsertConceptProgress,
  type ConceptProgressRow,
} from "@/lib/db";
import { adaptAfterIncorrectAnswer } from "@/lib/teach/adapt";
import { deriveMastery } from "@/lib/teach/assess";
import { evaluateAnswer } from "@/lib/teach/evaluate";

export const runtime = "nodejs";

const AnswerSchema = z.object({
  questionId: z.string().min(1),
  studentAnswer: z.string().min(1).max(5000),
});

function clampDifficulty(n: number): 1 | 2 | 3 | 4 | 5 {
  return Math.max(1, Math.min(5, n)) as 1 | 2 | 3 | 4 | 5;
}

/**
 * "Evaluate -> Adapt" — POST { questionId, studentAnswer }. A correct
 * answer just bumps difficulty and mastery. An incorrect/partial one
 * re-explains the concept with a different analogy than any already spent
 * on it this session, gives a new example and a fresh checkpoint question
 * (or drops to the prerequisite after repeated misses) — this is where the
 * adaptation the spec asks to be "visibly different" happens.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const body = await req.json().catch(() => undefined);
  const parsed = AnswerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", issues: parsed.error.issues }, { status: 400 });
  }

  const session = getLessonSession(sessionId);
  if (!session) return NextResponse.json({ error: `Lesson session ${sessionId} not found.` }, { status: 404 });

  const question = getQuestion(parsed.data.questionId);
  if (!question) return NextResponse.json({ error: `Question ${parsed.data.questionId} not found.` }, { status: 404 });

  const plan = getLessonPlanForSession(sessionId);
  const concept = plan?.concepts.find((c) => c.id === question.conceptId);
  if (!plan || !concept) {
    return NextResponse.json({ error: `Question ${question.id} does not belong to session ${sessionId}.` }, { status: 400 });
  }

  const learnerProfile = getLearnerProfile(session.learnerProfileId)!;

  const evaluation = await evaluateAnswer({
    question,
    concept,
    studentAnswer: parsed.data.studentAnswer,
    language: session.language,
  });

  const answerRow = recordStudentAnswer({
    questionId: question.id,
    lessonSessionId: sessionId,
    studentAnswer: evaluation.studentAnswer,
    verdict: evaluation.verdict,
    misconception: evaluation.misconception,
    feedback: evaluation.feedback,
    difficultyAdjustment: evaluation.difficultyAdjustment,
  });

  updateConceptProgress(learnerProfile.id, concept.id, concept.title, evaluation.verdict);

  const adaptState = getAdaptationState(sessionId, concept.id);

  if (evaluation.verdict === "correct") {
    recordAdaptationAttempt({
      lessonSessionId: sessionId,
      conceptId: concept.id,
      nextDifficulty: clampDifficulty((adaptState?.currentDifficulty ?? question.difficulty) + evaluation.difficultyAdjustment),
      countsAsAttempt: false,
    });
    return NextResponse.json({ evaluation: answerRow, adaptation: null });
  }

  const attemptNumber = (adaptState?.attemptCount ?? 0) + 1;
  const prerequisiteConcept = concept.prerequisiteConceptIds.length
    ? plan.concepts.find((c) => concept.prerequisiteConceptIds.includes(c.id))
    : undefined;

  const adaptation = await adaptAfterIncorrectAnswer({
    concept,
    evaluation: {
      verdict: evaluation.verdict,
      misconception: evaluation.misconception,
      studentAnswer: evaluation.studentAnswer,
      difficultyAdjustment: evaluation.difficultyAdjustment,
    },
    usedAnalogies: adaptState?.usedAnalogies ?? [],
    currentDifficulty: clampDifficulty(adaptState?.currentDifficulty ?? question.difficulty),
    learnerProfile,
    language: session.language,
    attemptNumber,
    prerequisiteConcept,
  });

  const existingScenes = getScenesForLessonPlan(plan.id);
  const nextOrder = existingScenes.length ? Math.max(...existingScenes.map((s) => s.order)) + 1 : 0;

  const followUpQuestionRow = createQuestion({
    conceptId: adaptation.targetConceptId,
    type: adaptation.followUpQuestion.type,
    prompt: adaptation.followUpQuestion.prompt,
    options: adaptation.followUpQuestion.options,
    referenceAnswer: adaptation.followUpQuestion.referenceAnswer,
    difficulty: adaptation.followUpQuestion.difficulty,
  });

  const reExplanationSceneRow = createScene({
    lessonPlanId: plan.id,
    conceptId: adaptation.targetConceptId,
    type: "explanation",
    order: nextOrder,
    narration: adaptation.reExplanationScene.narration,
    visual: adaptation.reExplanationScene.visual,
    estimatedSeconds: adaptation.reExplanationScene.estimatedSeconds,
  });

  const checkpointSceneRow = createScene({
    lessonPlanId: plan.id,
    conceptId: adaptation.targetConceptId,
    type: "checkpoint",
    order: nextOrder + 1,
    narration: adaptation.followUpQuestion.prompt,
    questionId: followUpQuestionRow.id,
    estimatedSeconds: 60,
  });

  recordAdaptationAttempt({
    lessonSessionId: sessionId,
    conceptId: adaptation.targetConceptId,
    analogyUsed: adaptation.analogyUsed,
    nextDifficulty: adaptation.nextDifficulty,
  });

  return NextResponse.json({
    evaluation: answerRow,
    adaptation: {
      targetConceptId: adaptation.targetConceptId,
      droppedToPrerequisite: adaptation.droppedToPrerequisite,
      reExplanationScene: reExplanationSceneRow,
      followUpQuestion: followUpQuestionRow,
      checkpointScene: checkpointSceneRow,
    },
  });
}

function updateConceptProgress(learnerProfileId: string, conceptId: string, conceptTitle: string, verdict: "correct" | "partial" | "incorrect"): ConceptProgressRow {
  const points = { correct: 100, partial: 50, incorrect: 0 }[verdict];
  const existing = getConceptProgressForLearner(learnerProfileId).find((p) => p.conceptId === conceptId);
  const masteryScore = existing ? Math.round(existing.masteryScore * 0.5 + points * 0.5) : points;
  return upsertConceptProgress({ learnerProfileId, conceptId, conceptTitle, mastery: deriveMastery(masteryScore), masteryScore });
}
