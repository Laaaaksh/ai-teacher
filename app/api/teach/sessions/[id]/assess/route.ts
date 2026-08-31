import { NextRequest, NextResponse } from "next/server";
import { createQuestion, getLearnerProfile, getLessonPlanForSession, getLessonSession, getQuestion, getStudentAnswersForSession } from "@/lib/db";
import { generateFinalQuiz } from "@/lib/teach/assess";
import { runLlm } from "../../../llmErrors";

export const runtime = "nodejs";

/**
 * "Continue" (part 1) — generates and persists the final quiz, drawn from
 * the concepts actually taught in this session and weighted toward
 * whatever the learner missed at checkpoints. Reference answers are
 * withheld from the response (schema convention: never shown to the
 * learner before evaluation). POST lib/teach's assess/submit with the
 * learner's answers to get the graded report.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;

  const session = getLessonSession(sessionId);
  if (!session) return NextResponse.json({ error: `Lesson session ${sessionId} not found.` }, { status: 404 });

  const plan = getLessonPlanForSession(sessionId);
  if (!plan) return NextResponse.json({ error: `No lesson plan for session ${sessionId}.` }, { status: 404 });

  const learnerProfile = getLearnerProfile(session.learnerProfileId)!;

  const checkpointAnswers = getStudentAnswersForSession(sessionId);
  const weakConceptTitles = [
    ...new Set(
      checkpointAnswers
        .filter((a) => a.verdict !== "correct")
        .map((a) => getQuestion(a.questionId)?.conceptId)
        .map((conceptId) => plan.concepts.find((c) => c.id === conceptId)?.title)
        .filter((title): title is string => Boolean(title)),
    ),
  ];

  const generated = await runLlm("Generating the final quiz", () =>
    generateFinalQuiz({
      concepts: plan.concepts,
      learnerProfile,
      language: session.language,
      emphasizeConceptTitles: weakConceptTitles,
    }),
  );
  if (!generated.ok) return generated.response;
  const drafts = generated.value;

  const quiz = drafts.map((d) =>
    createQuestion({
      conceptId: d.conceptId,
      type: d.type,
      prompt: d.prompt,
      options: d.options,
      referenceAnswer: d.referenceAnswer,
      difficulty: d.difficulty,
    }),
  );

  return NextResponse.json({
    quiz: quiz.map((q) => ({
      id: q.id,
      conceptId: q.conceptId,
      sceneId: q.sceneId,
      type: q.type,
      prompt: q.prompt,
      options: q.options,
      difficulty: q.difficulty,
      createdAt: q.createdAt,
    })),
  });
}
