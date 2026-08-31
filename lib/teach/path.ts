/**
 * For a broad topic ("teach me machine learning") or an explicit multi-day
 * request ("teach me over 7 days, 30 minutes a day"), an ordered
 * LearningPathStep[] with the learner's current position and what unlocks
 * next. Each step's own LessonPlan is generated lazily by lib/teach/plan.ts
 * when the learner actually starts that step (docs/SCHEMA.md: "steps...
 * once a LessonPlan has been generated for it") — this module only produces
 * the structure and progression, not every step's full lesson content
 * up front.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { json } from "./llm";
import type { LearnerProfileRow } from "../db/types";
import type { LearningPathStep } from "../types";

const StepDraftSchema = z.object({
  steps: z.array(z.object({ title: z.string(), summary: z.string() })),
});

export interface GenerateLearningPathInput {
  topic: string;
  learnerProfile: Pick<LearnerProfileRow, "level" | "goal" | "priorKnowledge">;
  mode: "broad-topic" | "multi-day";
  /** Required for mode "multi-day" — one step per session. */
  totalSessions?: number;
  minutesPerSession?: number;
}

export interface LearningPathStepDraft extends LearningPathStep {
  /** Not part of the persisted LearningPathStep — kept alongside it so the caller can hand this straight to planLesson() when the step is started. */
  summary: string;
}

export async function generateLearningPath(input: GenerateLearningPathInput): Promise<LearningPathStepDraft[]> {
  const isMultiDay = input.mode === "multi-day";
  if (isMultiDay && !input.totalSessions) {
    throw new Error("generateLearningPath: totalSessions is required for mode 'multi-day'.");
  }

  const draft = await json(StepDraftSchema, {
    messages: [
      {
        role: "system",
        content:
          (isMultiDay
            ? `Break "${input.topic}" into exactly ${input.totalSessions} sequential day-by-day sessions of about ${input.minutesPerSession ?? 30} minutes each, ` +
              `for a ${input.learnerProfile.level} learner (goal: ${input.learnerProfile.goal || "general understanding"}; prior knowledge: ${input.learnerProfile.priorKnowledge || "none stated"}). ` +
              "Order sessions by dependency (never teach something before its prerequisite). Title each step as 'Day N: <focus>'."
            : `Break the broad topic "${input.topic}" into an ordered learning path of 5-10 steps, ` +
              `for a ${input.learnerProfile.level} learner (goal: ${input.learnerProfile.goal || "general understanding"}; prior knowledge: ${input.learnerProfile.priorKnowledge || "none stated"}). ` +
              "Order steps by dependency, foundational material first (e.g. for 'machine learning': Python fundamentals before neural networks).") +
          `\n\nRespond with ONLY a JSON object of exactly this shape: {"steps": [{"title": string, "summary": string}]}`,
      },
      { role: "user", content: `Topic: ${input.topic}` },
    ],
    temperature: 0.4,
  });

  return draft.steps.map((s, order) => ({
    id: randomUUID(),
    order,
    title: s.title,
    summary: s.summary,
    conceptIds: [],
    status: order === 0 ? "available" : "locked",
  }));
}

/** Deterministic progression: completing a step unlocks the next locked one. */
export function unlockNextStep(steps: LearningPathStep[], completedStepIndex: number): LearningPathStep[] {
  return steps.map((step) => {
    if (step.order === completedStepIndex) return { ...step, status: "completed" };
    if (step.order === completedStepIndex + 1 && step.status === "locked") return { ...step, status: "available" };
    return step;
  });
}
