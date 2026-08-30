/**
 * "Adapt" — the heart of the grade. An incorrect/partial answer does not
 * just get marked wrong: the concept gets re-explained a genuinely
 * different way (a fresh analogy the learner hasn't seen for this concept),
 * a new example, and a new checkpoint question at an adjusted difficulty.
 * Repeated failure on the same concept drops down to its prerequisite
 * instead of repeating the same explanation a third time.
 *
 * "Different analogy" is enforced structurally, not just requested in the
 * prompt: the caller passes every analogy already spent on this concept
 * (lib/db's concept_adaptation_state, seeded with the original scripted
 * explanation's analogyLabel), the model is told never to reuse one, and the
 * result is checked against that list — a repeat is asked for again once,
 * with the repetition named explicitly, before that second answer is
 * accepted.
 *
 * When the drop to a prerequisite fires, the analogies spent on the
 * prerequisite itself are what must be banned (that is the concept being
 * re-explained), so the caller passes both lists and they are unioned here.
 */
import { z } from "zod";
import { json } from "./llm";
import { languageInstruction } from "./profile";
import { chooseVisualKind, renderedAs } from "./script";
import type { ScriptedBeat, ScriptedQuestion } from "./script";
import type { LearnerProfileRow } from "../db/types";
import type { AnswerEvaluation, Concept, LanguageCode, VisualRenderer } from "../types";

export interface AdaptationResult {
  /** The concept this adaptation actually re-teaches — usually `concept.id`, or the prerequisite's id when droppedToPrerequisite is true. */
  targetConceptId: string;
  reExplanationScene: ScriptedBeat;
  followUpQuestion: ScriptedQuestion;
  analogyUsed: string;
  nextDifficulty: 1 | 2 | 3 | 4 | 5;
  droppedToPrerequisite: boolean;
}

const AdaptSchema = z.object({
  reExplanationNarration: z.string(),
  analogyLabel: z.string(),
  visualContent: z.string(),
  visualCaption: z.string(),
  followUpQuestion: z.object({
    type: z.enum(["mcq", "short-answer", "problem-solving", "application", "explain-in-own-words"]),
    prompt: z.string(),
    options: z.array(z.string()).nullable(),
    referenceAnswer: z.string(),
  }),
});

/** Repeated failure on the same concept (2nd miss with a prerequisite available) drops down instead of a third attempt at the same content. */
const PREREQUISITE_DROP_THRESHOLD = 2;

export interface AdaptAfterIncorrectAnswerInput {
  concept: Concept;
  evaluation: Pick<AnswerEvaluation, "verdict" | "misconception" | "studentAnswer" | "difficultyAdjustment">;
  /** Every analogy already spent on this concept in this session, oldest first — the original scripted explanation's analogyLabel plus any prior adaptation's. */
  usedAnalogies: string[];
  /** The same list for `prerequisiteConcept`, which becomes the banned list when the drop fires — without it the prerequisite could be re-taught with the exact analogy it was first taught with. */
  prerequisiteUsedAnalogies?: string[];
  currentDifficulty: 1 | 2 | 3 | 4 | 5;
  learnerProfile: Pick<LearnerProfileRow, "level" | "style" | "priorKnowledge">;
  language: LanguageCode;
  /** How many times this concept has now been missed in this session (including this one). */
  attemptNumber: number;
  /** Supplied by the caller when concept.prerequisiteConceptIds is non-empty and attemptNumber crosses the drop threshold. */
  prerequisiteConcept?: Concept;
}

export async function adaptAfterIncorrectAnswer(input: AdaptAfterIncorrectAnswerInput): Promise<AdaptationResult> {
  const droppedToPrerequisite = input.attemptNumber >= PREREQUISITE_DROP_THRESHOLD && Boolean(input.prerequisiteConcept);
  const target = droppedToPrerequisite ? input.prerequisiteConcept! : input.concept;

  const nextDifficulty = clampDifficulty(
    droppedToPrerequisite ? Math.min(input.currentDifficulty, 2) : input.currentDifficulty + input.evaluation.difficultyAdjustment,
  );

  const misconceptionNote = input.evaluation.misconception
    ? `The student's specific misconception: "${input.evaluation.misconception.label}" — ${input.evaluation.misconception.description}. Address THIS directly, don't just re-teach generically.`
    : `The student's answer was ${input.evaluation.verdict}: "${input.evaluation.studentAnswer}".`;

  const usedAnalogies = droppedToPrerequisite
    ? unique([...(input.prerequisiteUsedAnalogies ?? []), ...input.usedAnalogies])
    : input.usedAnalogies;

  const explanationVisual = chooseVisualKind(target.subject, "explanation");

  const draft = await requestAdaptation({
    concept: target,
    learnerProfile: input.learnerProfile,
    language: input.language,
    misconceptionNote,
    usedAnalogies,
    visualRenderer: explanationVisual.renderer,
    droppedToPrerequisite,
    steppedBackFrom: droppedToPrerequisite ? input.concept.title : undefined,
    difficulty: nextDifficulty,
  });

  const narration = droppedToPrerequisite
    ? `Let's step back for a moment — before we can nail "${input.concept.title}", let's make sure "${target.title}" is solid. ${draft.reExplanationNarration}`
    : draft.reExplanationNarration;

  return {
    targetConceptId: target.id,
    reExplanationScene: {
      type: "explanation",
      narration,
      analogyLabel: draft.analogyLabel,
      visual: {
        kind: explanationVisual.kind,
        renderer: explanationVisual.renderer,
        content: draft.visualContent,
        caption: draft.visualCaption,
        rationale: explanationVisual.rationale,
      },
      estimatedSeconds: 90,
    },
    followUpQuestion: {
      type: draft.followUpQuestion.type,
      prompt: draft.followUpQuestion.prompt,
      options: draft.followUpQuestion.options ?? undefined,
      referenceAnswer: draft.followUpQuestion.referenceAnswer,
      difficulty: nextDifficulty,
    },
    analogyUsed: draft.analogyLabel,
    nextDifficulty,
    droppedToPrerequisite,
  };
}

function clampDifficulty(n: number): 1 | 2 | 3 | 4 | 5 {
  return Math.max(1, Math.min(5, n)) as 1 | 2 | 3 | 4 | 5;
}

function unique(values: string[]): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!seen.has(key)) seen.set(key, value);
  }
  return [...seen.values()];
}

interface AdaptationDraft {
  reExplanationNarration: string;
  analogyLabel: string;
  visualContent: string;
  visualCaption: string;
  followUpQuestion: z.infer<typeof AdaptSchema>["followUpQuestion"];
}

async function requestAdaptation(opts: {
  concept: Concept;
  learnerProfile: Pick<LearnerProfileRow, "level" | "style" | "priorKnowledge">;
  language: LanguageCode;
  misconceptionNote: string;
  usedAnalogies: string[];
  visualRenderer: VisualRenderer;
  droppedToPrerequisite: boolean;
  steppedBackFrom?: string;
  difficulty: number;
}): Promise<AdaptationDraft> {
  const bannedAnalogies = opts.usedAnalogies.length
    ? `Analogies ALREADY USED for this concept — you MUST NOT reuse any of these or a close variant: ${opts.usedAnalogies.join("; ")}.`
    : "No analogy has been used for this concept yet.";

  const messages = [
    {
      role: "system" as const,
      content:
        `A ${opts.learnerProfile.level} student got a checkpoint wrong on "${opts.concept.title}" (${opts.concept.summary}). ${opts.misconceptionNote} ` +
        `${bannedAnalogies} Re-explain the concept from a genuinely different angle — a different analogy, not just reworded prose — then give a new worked example, then ask a fresh checkpoint question at difficulty ${opts.difficulty}/5. ` +
        `analogyLabel must be a short 3-6 word tag naming the NEW analogy used, distinct from every banned one. ` +
        `Preferred style: ${opts.learnerProfile.style || "clear and direct"}. Prior knowledge: ${opts.learnerProfile.priorKnowledge || "none stated"}. ` +
        `${languageInstruction(opts.language)} ` +
        `visualContent must be real source for the "${opts.visualRenderer}" renderer (${renderedAs(opts.visualRenderer)}) illustrating the concept via the new analogy/example, not a description.` +
        `\n\nRespond with ONLY a JSON object of exactly this shape (no other keys, no markdown fences):\n` +
        `{"reExplanationNarration": string, "analogyLabel": string, "visualContent": string, "visualCaption": string, ` +
        `"followUpQuestion": {"type": one of "mcq"|"short-answer"|"problem-solving"|"application"|"explain-in-own-words", "prompt": string, "options": string[] or null, "referenceAnswer": string}}`,
    },
    { role: "user" as const, content: `Concept: ${opts.concept.title}\nSummary: ${opts.concept.summary}` },
  ];

  const first = await json(AdaptSchema, { messages, temperature: 0.7 });
  if (!isAnalogyReused(first.analogyLabel, opts.usedAnalogies)) return first;

  // The model reused a banned analogy despite the instruction — ask once more, explicitly calling out the repeat, rather than silently shipping a repeated explanation.
  const retry = await json(AdaptSchema, {
    messages: [
      ...messages,
      { role: "assistant" as const, content: JSON.stringify(first) },
      {
        role: "user" as const,
        content: `"${first.analogyLabel}" repeats (or is too close to) an already-used analogy. Give a completely different one — different domain, different mental model.`,
      },
    ],
    temperature: 0.8,
  });
  return retry;
}

function isAnalogyReused(label: string, used: string[]): boolean {
  const normalized = label.trim().toLowerCase();
  return used.some((u) => u.trim().toLowerCase() === normalized);
}
