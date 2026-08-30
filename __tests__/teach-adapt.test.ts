import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubChatSequence } from "./support/sarvamMock";
import { adaptAfterIncorrectAnswer } from "../lib/teach/adapt";
import type { Concept } from "../lib/types";

const ORIGINAL_KEY = process.env.SARVAM_API_KEY;

beforeEach(() => {
  process.env.SARVAM_API_KEY = "test-key";
});

afterEach(() => {
  process.env.SARVAM_API_KEY = ORIGINAL_KEY;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const CONCEPT: Concept = {
  id: "concept-1",
  title: "Ohm's Law",
  summary: "V = IR",
  subject: "physics",
  difficulty: 3,
  prerequisiteConceptIds: ["concept-0"],
  timeBudgetSeconds: 300,
  visual: { kind: "diagram", renderer: "mermaid", content: "", rationale: "r" },
  citations: [],
};

const PREREQUISITE: Concept = {
  id: "concept-0",
  title: "Current and Voltage",
  summary: "The two quantities Ohm's Law relates.",
  subject: "physics",
  difficulty: 1,
  prerequisiteConceptIds: [],
  timeBudgetSeconds: 180,
  visual: { kind: "diagram", renderer: "mermaid", content: "", rationale: "r" },
  citations: [],
};

const LEARNER = { level: "beginner" as const, style: "example-driven", priorKnowledge: "none" };

const EVALUATION = {
  verdict: "incorrect" as const,
  studentAnswer: "Current increases",
  difficultyAdjustment: -1 as const,
  misconception: {
    id: "m1",
    label: "inverse relationship confusion",
    description: "Believes current increases with resistance at constant voltage.",
    relatedConceptId: "concept-1",
  },
};

describe("adaptAfterIncorrectAnswer", () => {
  it("re-explains with a genuinely different analogy, a new example, and a fresh question at an adjusted difficulty", async () => {
    stubChatSequence({
      reExplanationNarration: "Think of resistance like a narrowing pipe...",
      analogyLabel: "narrowing pipe analogy for resistance",
      visualContent: "graph TD; Pipe-->Flow",
      visualCaption: "Narrowing pipe",
      followUpQuestion: {
        type: "mcq",
        prompt: "If the pipe narrows (resistance increases) and pressure (voltage) stays the same, does flow (current) go up or down?",
        options: ["Up", "Down"],
        referenceAnswer: "Down",
      },
    });

    const result = await adaptAfterIncorrectAnswer({
      concept: CONCEPT,
      evaluation: EVALUATION,
      usedAnalogies: ["water pipe analogy for current"],
      currentDifficulty: 2,
      learnerProfile: LEARNER,
      language: "en-IN",
      attemptNumber: 1,
    });

    expect(result.droppedToPrerequisite).toBe(false);
    expect(result.targetConceptId).toBe("concept-1");
    expect(result.analogyUsed).toBe("narrowing pipe analogy for resistance");
    expect(result.analogyUsed).not.toBe("water pipe analogy for current");
    expect(result.reExplanationScene.type).toBe("explanation");
    expect(result.reExplanationScene.narration).not.toContain("water pipe");
    expect(result.followUpQuestion.prompt).not.toBe("What happens to current if resistance increases at constant voltage?");
    expect(result.nextDifficulty).toBe(1); // 2 + (-1)
  });

  it("asks again when the model reuses a banned analogy, rather than shipping the repeat", async () => {
    stubChatSequence(
      {
        reExplanationNarration: "Same water pipe explanation again...",
        analogyLabel: "water pipe analogy for current", // reused — banned
        visualContent: "x",
        visualCaption: "x",
        followUpQuestion: { type: "mcq", prompt: "p", options: null, referenceAnswer: "a" },
      },
      {
        reExplanationNarration: "Let's use a crowd-in-a-corridor analogy instead...",
        analogyLabel: "crowd in a corridor analogy",
        visualContent: "y",
        visualCaption: "y",
        followUpQuestion: { type: "mcq", prompt: "p2", options: null, referenceAnswer: "a2" },
      },
    );

    const result = await adaptAfterIncorrectAnswer({
      concept: CONCEPT,
      evaluation: EVALUATION,
      usedAnalogies: ["water pipe analogy for current"],
      currentDifficulty: 2,
      learnerProfile: LEARNER,
      language: "en-IN",
      attemptNumber: 1,
    });

    expect(result.analogyUsed).toBe("crowd in a corridor analogy");
  });

  it("drops to the prerequisite concept after repeated failure", async () => {
    stubChatSequence({
      reExplanationNarration: "Let's rebuild the basics of current and voltage.",
      analogyLabel: "battery-as-hill analogy",
      visualContent: "x",
      visualCaption: "x",
      followUpQuestion: { type: "mcq", prompt: "What is current?", options: null, referenceAnswer: "Flow of charge" },
    });

    const result = await adaptAfterIncorrectAnswer({
      concept: CONCEPT,
      evaluation: EVALUATION,
      usedAnalogies: [],
      currentDifficulty: 2,
      learnerProfile: LEARNER,
      language: "en-IN",
      attemptNumber: 2, // second miss on this concept
      prerequisiteConcept: PREREQUISITE,
    });

    expect(result.droppedToPrerequisite).toBe(true);
    expect(result.targetConceptId).toBe("concept-0");
    expect(result.reExplanationScene.narration).toContain("Ohm's Law"); // the deterministic "step back" framing names what we're stepping back from
    expect(result.nextDifficulty).toBeLessThanOrEqual(2);
  });
});
