/**
 * "Continue" — a final quiz drawn from what was actually taught, then a
 * learning report naming real weak areas and misconceptions rather than a
 * generic pass/fail. Score, weak areas and understood concepts are computed
 * deterministically from recorded verdicts (never invented); the model only
 * phrases the recommendation prose, grounded in those numbers.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { json } from "./llm";
import { languageInstruction } from "./profile";
import type { LearnerProfileRow, MasteryLevel } from "../db/types";
import type { AnswerVerdict, AssessmentReport, Concept, LanguageCode, Misconception, QuestionType } from "../types";

// ---------------------------------------------------------------------------
// Final quiz generation
// ---------------------------------------------------------------------------

export interface QuizQuestionDraft {
  conceptId: string;
  type: QuestionType;
  prompt: string;
  options?: string[];
  referenceAnswer: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
}

const QuizSchema = z.object({
  questions: z.array(
    z.object({
      conceptTitle: z.string(),
      type: z.enum(["mcq", "short-answer", "problem-solving", "application", "explain-in-own-words"]),
      prompt: z.string(),
      options: z.array(z.string()).nullable(),
      referenceAnswer: z.string(),
      difficulty: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    }),
  ),
});

export interface GenerateFinalQuizInput {
  concepts: Concept[];
  learnerProfile: Pick<LearnerProfileRow, "level">;
  language: LanguageCode;
  /** Concept titles to weight more heavily — e.g. ones the learner struggled with during checkpoints. */
  emphasizeConceptTitles?: string[];
  questionCount?: number;
}

export async function generateFinalQuiz(input: GenerateFinalQuizInput): Promise<QuizQuestionDraft[]> {
  const questionCount = input.questionCount ?? Math.min(8, Math.max(3, input.concepts.length));
  const emphasis = input.emphasizeConceptTitles?.length
    ? ` Weight the quiz toward these concepts the learner struggled with during the lesson: ${input.emphasizeConceptTitles.join(", ")}.`
    : "";

  const draft = await json(QuizSchema, {
    messages: [
      {
        role: "system",
        content:
          `Write a ${questionCount}-question final quiz covering the concepts below, for a ${input.learnerProfile.level} learner. ` +
          `Every question's conceptTitle must exactly match one of the given concept titles. Mix question types; vary difficulty appropriately.${emphasis} ` +
          `${languageInstruction(input.language)} ` +
          `\n\nRespond with ONLY a JSON object of exactly this shape (no other keys, no markdown fences):\n` +
          `{"questions": [{"conceptTitle": string, "type": one of "mcq"|"short-answer"|"problem-solving"|"application"|"explain-in-own-words", "prompt": string, "options": string[] or null, "referenceAnswer": string, "difficulty": integer 1-5}]}`,
      },
      {
        role: "user",
        content: input.concepts.map((c) => `- ${c.title}: ${c.summary}`).join("\n"),
      },
    ],
    temperature: 0.5,
  });

  const byTitle = new Map(input.concepts.map((c) => [c.title.trim().toLowerCase(), c]));

  return draft.questions
    .map((q) => ({ q, concept: byTitle.get(q.conceptTitle.trim().toLowerCase()) }))
    .filter((x): x is { q: (typeof draft.questions)[number]; concept: Concept } => Boolean(x.concept))
    .map(({ q, concept }) => ({
      conceptId: concept.id,
      type: q.type,
      prompt: q.prompt,
      options: q.options ?? undefined,
      referenceAnswer: q.referenceAnswer,
      difficulty: q.difficulty,
    }));
}

// ---------------------------------------------------------------------------
// Score, weak areas, mastery — deterministic
// ---------------------------------------------------------------------------

export interface ConceptResult {
  conceptId: string;
  conceptTitle: string;
  verdict: AnswerVerdict;
  misconception?: Misconception;
}

const VERDICT_POINTS: Record<AnswerVerdict, number> = { correct: 100, partial: 50, incorrect: 0 };

export function computeScore(results: ConceptResult[]): number {
  if (results.length === 0) return 0;
  const total = results.reduce((sum, r) => sum + VERDICT_POINTS[r.verdict], 0);
  return Math.round(total / results.length);
}

export function deriveMastery(score: number): MasteryLevel {
  if (score >= 90) return "mastered";
  if (score >= 70) return "proficient";
  if (score >= 40) return "developing";
  if (score > 0) return "struggling";
  return "not-started";
}

/** Latest result per concept (a concept quizzed more than once keeps only its final verdict — what the learner knows NOW, not their first attempt). */
function latestPerConcept(results: ConceptResult[]): ConceptResult[] {
  const byConceptInOrder = new Map<string, ConceptResult>();
  for (const r of results) byConceptInOrder.set(r.conceptId, r);
  return [...byConceptInOrder.values()];
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

const ReportProseSchema = z.object({ recommendedRevision: z.string(), suggestedNextTopic: z.string() });

export interface GenerateAssessmentReportInput {
  lessonSessionId: string;
  topic: string;
  concepts: Concept[];
  quizResults: ConceptResult[];
  learnerProfile: Pick<LearnerProfileRow, "level" | "goal">;
  language: LanguageCode;
}

export async function generateAssessmentReport(
  input: GenerateAssessmentReportInput,
): Promise<Omit<AssessmentReport, "id" | "generatedAt">> {
  const results = latestPerConcept(input.quizResults);
  const score = computeScore(results);

  const weakAreas = results.filter((r) => r.verdict !== "correct").map((r) => r.conceptTitle);
  const conceptsUnderstood = results.filter((r) => r.verdict === "correct").map((r) => r.conceptTitle);
  const misconceptionsHeld: Misconception[] = results
    .filter((r) => r.verdict !== "correct" && r.misconception)
    .map((r) => r.misconception!);

  const { recommendedRevision, suggestedNextTopic } = await json(ReportProseSchema, {
    messages: [
      {
        role: "system",
        content:
          `Write a short (1-2 sentence) revision recommendation and a suggested next topic for a ${input.learnerProfile.level} learner ` +
          `who just finished a lesson on "${input.topic}" (goal: ${input.learnerProfile.goal || "general understanding"}), scoring ${score}%. ` +
          `Base the recommendation ONLY on the weak areas/misconceptions given below — don't invent problems that weren't found. ` +
          `${languageInstruction(input.language)} ` +
          `\n\nRespond with ONLY a JSON object of exactly this shape: {"recommendedRevision": string, "suggestedNextTopic": string}`,
      },
      {
        role: "user",
        content:
          `Weak areas: ${weakAreas.join(", ") || "none"}.\n` +
          `Misconceptions still held: ${misconceptionsHeld.map((m) => m.label).join(", ") || "none"}.\n` +
          `Concepts understood: ${conceptsUnderstood.join(", ") || "none"}.`,
      },
    ],
    temperature: 0.4,
  });

  return {
    lessonSessionId: input.lessonSessionId,
    topic: input.topic,
    score,
    conceptsUnderstood,
    weakAreas,
    misconceptionsHeld,
    recommendedRevision,
    suggestedNextTopic,
  };
}

/** Assigns a fresh id — reports are persisted via lib/db's createAssessmentReport, which generates its own id; this is for tests/consumers that need a standalone AssessmentReport value. */
export function withId(report: Omit<AssessmentReport, "id" | "generatedAt">): AssessmentReport {
  return { ...report, id: randomUUID(), generatedAt: new Date().toISOString() };
}
