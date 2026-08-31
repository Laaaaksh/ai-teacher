import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DB_PATH = ":memory:";
process.env.SARVAM_API_KEY = "test-key";

import { resetDbForTests } from "../lib/db/connection";
import { createLearnerProfile } from "../lib/db/accessors/learners";
import { createLessonPlan } from "../lib/db/accessors/lessonPlans";
import { createLessonSession, getLessonSession } from "../lib/db/accessors/lessonSessions";
import { getScenesForLessonPlan } from "../lib/db/accessors/scenes";
import { getAdaptationState } from "../lib/db/accessors/adaptationState";
import { firstAdaptationSceneOrder, planTaughtLessonSession, scriptTaughtLessonSession } from "../lib/teach/session";
import type { Concept, LearnerProfile } from "../lib/types";
import type { LessonPlanRow, LessonSessionRow } from "../lib/db/types";

const ORIGINAL_KEY = process.env.SARVAM_API_KEY;

beforeEach(() => {
  resetDbForTests();
  process.env.SARVAM_API_KEY = "test-key";
});

afterEach(() => {
  process.env.SARVAM_API_KEY = ORIGINAL_KEY;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function chatCompletion(content: unknown): Response {
  return jsonResponse({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }] });
}

function makeLearner() {
  return createLearnerProfile({
    name: "Test Learner",
    level: "beginner",
    priorKnowledge: "none",
    goal: "pass exam",
    style: "analogy-heavy",
    language: "en-IN",
    minutesAvailable: 20,
    depth: "standard",
  });
}

function makeConcept(overrides: Partial<Concept>): Concept {
  return {
    id: crypto.randomUUID(),
    title: "Untitled",
    summary: "s",
    subject: "physics",
    difficulty: 2,
    prerequisiteConceptIds: [],
    timeBudgetSeconds: 300,
    visual: { kind: "diagram", renderer: "mermaid", content: "", rationale: "r" },
    citations: [],
    ...overrides,
  };
}

function corePayload(tag: string) {
  return {
    introductionNarration: `intro ${tag}`,
    explanationNarration: `explanation ${tag}`,
    explanationAnalogyLabel: `${tag} analogy`,
    explanationVisualContent: "x",
    explanationVisualCaption: "c",
  };
}

function practicePayload(tag: string) {
  return {
    exampleNarration: `example ${tag}`,
    exampleVisualContent: "x",
    exampleVisualCaption: "c",
    transitionNarration: `transition ${tag}`,
    checkpointQuestion: { type: "mcq", prompt: `question ${tag}`, options: ["a", "b"], referenceAnswer: "a", difficulty: 2 },
    checkpointVisualContent: "x",
    checkpointVisualCaption: "c",
  };
}

/** Builds a plan directly via lib/db, bypassing planLesson()'s own LLM call — these tests are about scriptTaughtLessonSession's concurrency/failure handling, not planning. */
function makePlannedSession(learner: LearnerProfile, concepts: Concept[]): { session: LessonSessionRow; plan: LessonPlanRow } {
  const session = createLessonSession({ learnerProfileId: learner.id, topic: "T", language: learner.language, totalMinutes: 20, depth: "standard" });
  const plan = createLessonPlan({
    lessonSessionId: session.id,
    learnerProfileId: learner.id,
    topic: "T",
    language: learner.language,
    totalMinutes: 20,
    depth: "standard",
    concepts,
  });
  return { session, plan };
}

describe("planTaughtLessonSession", () => {
  it("plans and persists session/plan/concepts without scripting anything (scriptingStatus stays pending)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementationOnce(async () =>
        chatCompletion({
          concepts: [
            {
              title: "Ohm's Law",
              summary: "s",
              subject: "physics",
              difficulty: 2,
              prerequisiteTitles: [],
              citedChunkIndices: null,
              visualContent: "V=IR",
              visualCaption: "c",
            },
          ],
        }),
      ),
    );

    const learner = makeLearner();
    const { session, plan } = await planTaughtLessonSession({
      learnerProfile: learner,
      topic: "Ohm's Law",
      totalMinutes: 10,
      depth: "standard",
      language: "en-IN",
    });

    expect(session.scriptingStatus).toBe("pending");
    expect(plan.concepts).toHaveLength(1);
    expect(getScenesForLessonPlan(plan.id)).toHaveLength(0);
  });
});

describe("scriptTaughtLessonSession", () => {
  it("scenes end up ordered by declared concept sequence, regardless of which concept's calls resolve first", async () => {
    const learner = makeLearner();
    const conceptA = makeConcept({ title: "A" });
    const conceptB = makeConcept({ title: "B" });
    const { session, plan } = makePlannedSession(learner, [conceptA, conceptB]);

    // A's calls are DELAYED (resolve after B's), but A is declared first — its scenes must still get the lower `order` values.
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(chatCompletion(corePayload("A"))), 20)))
      .mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(chatCompletion(practicePayload("A"))), 20)))
      .mockImplementationOnce(async () => chatCompletion(corePayload("B")))
      .mockImplementationOnce(async () => chatCompletion(practicePayload("B")))
      .mockImplementationOnce(async () => chatCompletion({ narration: "summary" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await scriptTaughtLessonSession(session, plan, learner, "en-IN");

    expect(result.status).toBe("ready");
    expect(result.failedConceptTitles).toEqual([]);

    const scenes = getScenesForLessonPlan(plan.id);
    const aScenes = scenes.filter((s) => s.conceptId === conceptA.id);
    const bScenes = scenes.filter((s) => s.conceptId === conceptB.id);
    expect(Math.max(...aScenes.map((s) => s.order))).toBeLessThan(Math.min(...bScenes.map((s) => s.order)));

    // Adaptation scenes are minted while scripting may still be in flight, so their first order must clear every slot this plan reserves.
    expect(firstAdaptationSceneOrder(plan.concepts.length)).toBeGreaterThan(Math.max(...scenes.map((s) => s.order)));

    const seeded = getAdaptationState(session.id, conceptA.id);
    expect(seeded?.usedAnalogies).toEqual(["A analogy"]);
  });

  it("isolates a single concept's scripting failure — other concepts still get scripted, status becomes 'partial'", async () => {
    const learner = makeLearner();
    const conceptA = makeConcept({ title: "A" });
    const conceptB = makeConcept({ title: "B" });
    const { session, plan } = makePlannedSession(learner, [conceptA, conceptB]);

    // A's core call fails outright (network error — not one of llm.ts's retryable kinds, so it fails on the first attempt).
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error("network down");
      })
      .mockImplementationOnce(async () => chatCompletion(practicePayload("A")))
      .mockImplementationOnce(async () => chatCompletion(corePayload("B")))
      .mockImplementationOnce(async () => chatCompletion(practicePayload("B")))
      .mockImplementationOnce(async () => chatCompletion({ narration: "summary" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await scriptTaughtLessonSession(session, plan, learner, "en-IN");

    expect(result.status).toBe("partial");
    expect(result.failedConceptTitles).toEqual(["A"]);

    const scenes = getScenesForLessonPlan(plan.id);
    expect(scenes.some((s) => s.conceptId === conceptA.id)).toBe(false);
    expect(scenes.some((s) => s.conceptId === conceptB.id)).toBe(true);

    const session2 = getLessonSession(session.id)!;
    expect(session2.scriptingStatus).toBe("partial");
    expect(session2.scriptingError).toContain("A");
  });
});
