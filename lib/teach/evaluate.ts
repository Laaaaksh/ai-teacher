/**
 * "Evaluate" — judges a student's answer against the concept it was asked
 * about. A wrong answer is never just "incorrect": the spec's own example
 * ("current increases when resistance increases") is a specific
 * inverse-relationship misconception, and naming it is what makes adapt.ts's
 * re-explanation possible, not just a retry of the same content.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { json } from "./llm";
import { languageInstruction } from "./profile";
import type { QuestionRow } from "../db/types";
import type { AnswerVerdict, Concept, LanguageCode, Misconception } from "../types";

export interface EvaluateAnswerInput {
  question: QuestionRow;
  concept: Pick<Concept, "id" | "title" | "summary">;
  studentAnswer: string;
  language: LanguageCode;
}

export type EvaluationResult = Omit<import("../types").AnswerEvaluation, "id" | "questionId" | "evaluatedAt">;

const EvalSchema = z
  .object({
    verdict: z.enum(["correct", "partial", "incorrect"]),
    misconceptionLabel: z.string().nullable(),
    misconceptionDescription: z.string().nullable(),
    feedback: z.string(),
    difficultyAdjustment: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  })
  .refine((v) => v.verdict === "correct" || (v.misconceptionLabel && v.misconceptionDescription), {
    message: "A partial or incorrect verdict must name a misconception (label + description), not just mark the answer wrong.",
  });

function exactMcqMatch(question: QuestionRow, studentAnswer: string): boolean {
  if (question.type !== "mcq") return false;
  const normalize = (s: string) => s.trim().toLowerCase();
  return normalize(studentAnswer) === normalize(question.referenceAnswer);
}

export async function evaluateAnswer(input: EvaluateAnswerInput): Promise<EvaluationResult> {
  const { question, concept, studentAnswer, language } = input;

  // An exact MCQ match to the reference answer is unambiguous — evaluating
  // it with the model would just add latency and a (small) hallucination
  // surface for a verdict that's already deterministic.
  if (exactMcqMatch(question, studentAnswer)) {
    return {
      studentAnswer,
      verdict: "correct",
      feedback: "Correct.",
      difficultyAdjustment: 1,
    };
  }

  const result = await json(EvalSchema, {
    messages: [
      {
        role: "system",
        content:
          `You are evaluating a student's answer to a checkpoint question on the concept "${concept.title}" (${concept.summary}). ` +
          `Question: ${question.prompt}${question.options ? ` Options: ${question.options.join(" | ")}` : ""} ` +
          `Reference answer / rubric: ${question.referenceAnswer}. ` +
          "Judge correct/partial/incorrect. If not fully correct, you MUST name the specific misconception behind the mistake — not just 'wrong'. " +
          "For example, if asked what happens to current when resistance increases at constant voltage and the student says 'current increases', the misconception is a specific inverse-relationship confusion (Ohm's Law: I = V/R), not just 'incorrect answer'. " +
          `${languageInstruction(language)} (feedback and misconception description). ` +
          `\n\nRespond with ONLY a JSON object of exactly this shape (no other keys, no markdown fences):\n` +
          `{"verdict": one of "correct"|"partial"|"incorrect", "misconceptionLabel": string or null (null only if verdict is "correct"), "misconceptionDescription": string or null, "feedback": string, "difficultyAdjustment": one of -1|0|1}`,
      },
      { role: "user", content: `Student answer: ${studentAnswer}` },
    ],
    temperature: 0.2,
  });

  const misconception: Misconception | undefined =
    result.verdict !== "correct" && result.misconceptionLabel && result.misconceptionDescription
      ? {
          id: randomUUID(),
          label: result.misconceptionLabel,
          description: result.misconceptionDescription,
          relatedConceptId: concept.id,
        }
      : undefined;

  return {
    studentAnswer,
    verdict: result.verdict as AnswerVerdict,
    misconception,
    feedback: result.feedback,
    difficultyAdjustment: result.difficultyAdjustment,
  };
}
