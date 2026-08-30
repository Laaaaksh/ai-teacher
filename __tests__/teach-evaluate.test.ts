import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubChatSequence } from "./support/sarvamMock";
import { evaluateAnswer } from "../lib/teach/evaluate";
import type { QuestionRow } from "../lib/db/types";

const ORIGINAL_KEY = process.env.SARVAM_API_KEY;

beforeEach(() => {
  process.env.SARVAM_API_KEY = "test-key";
});

afterEach(() => {
  process.env.SARVAM_API_KEY = ORIGINAL_KEY;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const CONCEPT = { id: "concept-1", title: "Ohm's Law", summary: "V = IR" };

const MCQ: QuestionRow = {
  id: "q1",
  conceptId: "concept-1",
  sceneId: null,
  type: "mcq",
  prompt: "What happens to current if resistance increases at constant voltage?",
  options: ["It increases", "It decreases", "It stays the same"],
  referenceAnswer: "It decreases",
  difficulty: 2,
  createdAt: "now",
};

describe("evaluateAnswer", () => {
  it("short-circuits an exact MCQ match to 'correct' without calling the model", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await evaluateAnswer({ question: MCQ, concept: CONCEPT, studentAnswer: "It decreases", language: "en-IN" });

    expect(result.verdict).toBe("correct");
    expect(result.misconception).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names the specific misconception behind a wrong answer, not just 'incorrect'", async () => {
    stubChatSequence({
      verdict: "incorrect",
      misconceptionLabel: "inverse relationship confusion",
      misconceptionDescription: "Believes current increases with resistance at constant voltage, the inverse of Ohm's Law (I = V/R).",
      feedback: "Not quite — as resistance goes up, current goes down at constant voltage.",
      difficultyAdjustment: -1,
    });

    const result = await evaluateAnswer({ question: MCQ, concept: CONCEPT, studentAnswer: "It increases", language: "en-IN" });

    expect(result.verdict).toBe("incorrect");
    expect(result.misconception?.label).toBe("inverse relationship confusion");
    expect(result.misconception?.relatedConceptId).toBe("concept-1");
    expect(result.difficultyAdjustment).toBe(-1);
  });

  it("evaluates free-text answers through the model", async () => {
    const shortAnswer: QuestionRow = { ...MCQ, type: "short-answer", options: null };
    stubChatSequence({
      verdict: "partial",
      misconceptionLabel: "incomplete relationship",
      misconceptionDescription: "Correctly says current decreases but doesn't connect it to Ohm's Law.",
      feedback: "Right direction, but explain why using V = IR.",
      difficultyAdjustment: 0,
    });

    const result = await evaluateAnswer({ question: shortAnswer, concept: CONCEPT, studentAnswer: "current goes down", language: "en-IN" });
    expect(result.verdict).toBe("partial");
    expect(result.misconception).toBeDefined();
  });
});
