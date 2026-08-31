import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubChatSequence } from "./support/sarvamMock";
import { computeScore, deriveMastery, generateAssessmentReport, generateFinalQuiz, type ConceptResult } from "../lib/teach/assess";
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

describe("computeScore / deriveMastery", () => {
  it("matches the spec's worked example: 4/5 correct, 1 incorrect -> 80%", () => {
    const results: ConceptResult[] = [
      { conceptId: "1", conceptTitle: "Current", verdict: "correct" },
      { conceptId: "2", conceptTitle: "Voltage", verdict: "correct" },
      { conceptId: "3", conceptTitle: "Power", verdict: "correct" },
      { conceptId: "4", conceptTitle: "Circuits", verdict: "correct" },
      { conceptId: "5", conceptTitle: "Resistance", verdict: "incorrect" },
    ];
    expect(computeScore(results)).toBe(80);
  });

  it("weights a partial verdict as half credit", () => {
    expect(computeScore([{ conceptId: "1", conceptTitle: "X", verdict: "partial" }])).toBe(50);
  });

  it.each([
    [95, "mastered"],
    [75, "proficient"],
    [50, "developing"],
    [20, "struggling"],
    [0, "not-started"],
  ] as const)("maps score %i to mastery %s", (score, mastery) => {
    expect(deriveMastery(score)).toBe(mastery);
  });
});

describe("generateFinalQuiz", () => {
  it("maps model-produced conceptTitle back to the real concept id, dropping unmatched titles", async () => {
    const concepts: Concept[] = [
      { id: "c1", title: "Ohm's Law", summary: "V=IR", subject: "physics", difficulty: 2, prerequisiteConceptIds: [], timeBudgetSeconds: 100, visual: { kind: "equation", renderer: "katex", content: "", rationale: "r" }, citations: [] },
    ];

    stubChatSequence({
      questions: [
        { conceptTitle: "Ohm's Law", type: "mcq", prompt: "p1", options: ["a", "b"], referenceAnswer: "a", difficulty: 2 },
        { conceptTitle: "Nonexistent Concept", type: "mcq", prompt: "p2", options: null, referenceAnswer: "x", difficulty: 1 },
      ],
    });

    const quiz = await generateFinalQuiz({ concepts, learnerProfile: { level: "beginner" }, language: "en-IN" });

    expect(quiz).toHaveLength(1);
    expect(quiz[0].conceptId).toBe("c1");
  });
});

describe("generateAssessmentReport", () => {
  it("computes weak areas and misconceptions deterministically from quiz verdicts, and grounds the LLM prose in them", async () => {
    stubChatSequence({
      recommendedRevision: "Revise Ohm's Law and try two more practice problems.",
      suggestedNextTopic: "Series and parallel circuits",
    });

    const results: ConceptResult[] = [
      { conceptId: "1", conceptTitle: "Current", verdict: "correct" },
      {
        conceptId: "2",
        conceptTitle: "Resistance",
        verdict: "incorrect",
        misconception: { id: "m1", label: "inverse relationship confusion", description: "d", relatedConceptId: "2" },
      },
    ];

    const report = await generateAssessmentReport({
      lessonSessionId: "session-1",
      topic: "Electricity",
      concepts: [],
      quizResults: results,
      learnerProfile: { level: "beginner", goal: "pass exam" },
      language: "en-IN",
    });

    expect(report.score).toBe(50);
    expect(report.conceptsUnderstood).toEqual(["Current"]);
    expect(report.weakAreas).toEqual(["Resistance"]);
    expect(report.misconceptionsHeld).toHaveLength(1);
    expect(report.misconceptionsHeld[0].label).toBe("inverse relationship confusion");
    expect(report.recommendedRevision).toContain("Ohm's Law");
  });
});
