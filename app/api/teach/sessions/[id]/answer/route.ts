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
} from "@/lib/db";
import { adaptAfterIncorrectAnswer } from "@/lib/teach/adapt";
import { recordVerdictProgress } from "@/lib/teach/assess";
import { evaluateAnswer } from "@/lib/teach/evaluate";
import { firstAdaptationSceneOrder } from "@/lib/teach/session";
import { runLlm } from "../../../llmErrors";

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
 *
 * Nothing is recorded until every model call for this answer has succeeded:
 * an adaptation that fails upstream returns 502 with the answer unrecorded,
 * so the client's retry grades the attempt once rather than blending the
 * same answer into mastery twice.
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

  const evaluated = await runLlm("Evaluating the answer", () =>
    evaluateAnswer({ question, concept, studentAnswer: parsed.data.studentAnswer, language: session.language }),
  );
  if (!evaluated.ok) return evaluated.response;
  const evaluation = evaluated.value;

  const recordAnswer = () =>
    recordStudentAnswer({
      questionId: question.id,
      lessonSessionId: sessionId,
      studentAnswer: evaluation.studentAnswer,
      verdict: evaluation.verdict,
      misconception: evaluation.misconception,
      feedback: evaluation.feedback,
      difficultyAdjustment: evaluation.difficultyAdjustment,
    });

  const updateProgress = () =>
    recordVerdictProgress({
      learnerProfileId: learnerProfile.id,
      conceptId: concept.id,
      conceptTitle: concept.title,
      verdict: evaluation.verdict,
      previousScore: getConceptProgressForLearner(learnerProfile.id).find((p) => p.conceptId === concept.id)?.masteryScore,
    });

  const adaptState = getAdaptationState(sessionId, concept.id);
  const currentDifficulty = clampDifficulty(adaptState?.currentDifficulty ?? question.difficulty);

  if (evaluation.verdict === "correct") {
    const answerRow = recordAnswer();
    updateProgress();
    recordAdaptationAttempt({
      lessonSessionId: sessionId,
      conceptId: concept.id,
      nextDifficulty: clampDifficulty(currentDifficulty + evaluation.difficultyAdjustment),
      countsAsAttempt: false,
    });
    return NextResponse.json({ evaluation: answerRow, adaptation: null });
  }

  const attemptNumber = (adaptState?.attemptCount ?? 0) + 1;
  const prerequisiteConcept = concept.prerequisiteConceptIds.length
    ? plan.concepts.find((c) => concept.prerequisiteConceptIds.includes(c.id))
    : undefined;

  const adapted = await runLlm("Adapting after the incorrect answer", () =>
    adaptAfterIncorrectAnswer({
      concept,
      evaluation: {
        verdict: evaluation.verdict,
        misconception: evaluation.misconception,
        studentAnswer: evaluation.studentAnswer,
        difficultyAdjustment: evaluation.difficultyAdjustment,
      },
      usedAnalogies: adaptState?.usedAnalogies ?? [],
      // The drop re-explains the *prerequisite*, so its own spent analogies are the ones that must be banned.
      prerequisiteUsedAnalogies: prerequisiteConcept
        ? getAdaptationState(sessionId, prerequisiteConcept.id)?.usedAnalogies ?? []
        : undefined,
      currentDifficulty,
      learnerProfile,
      language: session.language,
      attemptNumber,
      prerequisiteConcept,
    }),
  );
  if (!adapted.ok) return adapted.response;
  const adaptation = adapted.value;

  const answerRow = recordAnswer();
  updateProgress();

  /* Not `max(existing order) + 1`: scripting runs in the background, so the
   * scenes that exist right now can be a prefix of the lesson, and the slots
   * above them are already reserved for concepts still being scripted. */
  const existingScenes = getScenesForLessonPlan(plan.id);
  const nextOrder = Math.max(
    firstAdaptationSceneOrder(plan.concepts.length),
    existingScenes.length ? Math.max(...existingScenes.map((s) => s.order)) + 1 : 0,
  );

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

  /* A drop records its analogy against the prerequisite, so the miss on the
   * concept the learner actually failed has to be counted separately —
   * otherwise its attemptCount stalls and every later miss re-triggers the
   * same drop from the same stale state. */
  if (adaptation.droppedToPrerequisite) {
    recordAdaptationAttempt({
      lessonSessionId: sessionId,
      conceptId: concept.id,
      nextDifficulty: currentDifficulty,
    });
  }

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
