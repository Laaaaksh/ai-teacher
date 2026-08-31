import { beforeEach, describe, expect, it } from "vitest";

process.env.DB_PATH = ":memory:";

import { resetDbForTests } from "../lib/db/connection";
import { createLearnerProfile } from "../lib/db/accessors/learners";
import { createLessonSession } from "../lib/db/accessors/lessonSessions";
import { createLessonPlan } from "../lib/db/accessors/lessonPlans";
import { getAdaptationState, recordAdaptationAttempt, seedAdaptationState } from "../lib/db/accessors/adaptationState";
import type { Concept } from "../lib/types";

beforeEach(() => {
  resetDbForTests();
});

function makeConcept(overrides: Partial<Concept> = {}): Concept {
  return {
    id: crypto.randomUUID(),
    title: "Ohm's Law",
    summary: "V = IR",
    subject: "physics",
    difficulty: 2,
    prerequisiteConceptIds: [],
    timeBudgetSeconds: 300,
    visual: { kind: "equation", renderer: "katex", content: "V = IR", rationale: "Physics equation" },
    citations: [],
    ...overrides,
  };
}

function makeSessionAndConcept() {
  const learner = createLearnerProfile({
    name: "Test Learner",
    level: "beginner",
    priorKnowledge: "none",
    goal: "pass exam",
    style: "analogy-heavy",
    language: "en-IN",
    minutesAvailable: 20,
    depth: "standard",
  });
  const session = createLessonSession({ learnerProfileId: learner.id, topic: "Electricity", language: "en-IN", totalMinutes: 20, depth: "standard" });
  const concept = makeConcept();
  createLessonPlan({
    lessonSessionId: session.id,
    learnerProfileId: learner.id,
    topic: "Electricity",
    language: "en-IN",
    totalMinutes: 20,
    depth: "standard",
    concepts: [concept],
  });
  return { session, concept };
}

describe("concept_adaptation_state accessor", () => {
  it("seeds the original analogy without counting it as an attempt", () => {
    const { session, concept } = makeSessionAndConcept();

    const seeded = seedAdaptationState({
      lessonSessionId: session.id,
      conceptId: concept.id,
      initialAnalogy: "water pipe analogy for current",
      initialDifficulty: 2,
    });

    expect(seeded.usedAnalogies).toEqual(["water pipe analogy for current"]);
    expect(seeded.attemptCount).toBe(0);
  });

  it("seed is a no-op once adaptation has already recorded an attempt", () => {
    const { session, concept } = makeSessionAndConcept();
    seedAdaptationState({ lessonSessionId: session.id, conceptId: concept.id, initialAnalogy: "a", initialDifficulty: 2 });
    recordAdaptationAttempt({ lessonSessionId: session.id, conceptId: concept.id, analogyUsed: "b", nextDifficulty: 1 });

    seedAdaptationState({ lessonSessionId: session.id, conceptId: concept.id, initialAnalogy: "c", initialDifficulty: 3 });

    const state = getAdaptationState(session.id, concept.id);
    expect(state?.usedAnalogies).toEqual(["a", "b"]); // "c" never applied — INSERT OR IGNORE
    expect(state?.attemptCount).toBe(1);
  });

  it("accumulates every distinct analogy across repeated misses", () => {
    const { session, concept } = makeSessionAndConcept();
    recordAdaptationAttempt({ lessonSessionId: session.id, conceptId: concept.id, analogyUsed: "water pipe", nextDifficulty: 2 });
    recordAdaptationAttempt({ lessonSessionId: session.id, conceptId: concept.id, analogyUsed: "narrowing road", nextDifficulty: 1 });

    const state = getAdaptationState(session.id, concept.id);
    expect(state?.usedAnalogies).toEqual(["water pipe", "narrowing road"]);
    expect(state?.attemptCount).toBe(2);
    expect(state?.currentDifficulty).toBe(1);
  });

  it("a correct-answer difficulty bump does not count toward the attempt count", () => {
    const { session, concept } = makeSessionAndConcept();
    recordAdaptationAttempt({ lessonSessionId: session.id, conceptId: concept.id, analogyUsed: "x", nextDifficulty: 2 });
    recordAdaptationAttempt({ lessonSessionId: session.id, conceptId: concept.id, nextDifficulty: 3, countsAsAttempt: false });

    const state = getAdaptationState(session.id, concept.id);
    expect(state?.attemptCount).toBe(1);
    expect(state?.currentDifficulty).toBe(3);
  });
});
