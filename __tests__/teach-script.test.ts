import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubChatSequence } from "./support/sarvamMock";
import { chooseVisualKind, scriptConcept } from "../lib/teach/script";
import type { Concept, Subject } from "../lib/types";

const ORIGINAL_KEY = process.env.SARVAM_API_KEY;

beforeEach(() => {
  process.env.SARVAM_API_KEY = "test-key";
});

afterEach(() => {
  process.env.SARVAM_API_KEY = ORIGINAL_KEY;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("chooseVisualKind — the deliberate, inspectable subject -> visual decision", () => {
  const cases: Array<[Subject, string]> = [
    ["mathematics", "katex"],
    ["physics", "mermaid"],
    ["biology", "mermaid"],
    ["chemistry", "mermaid"],
    ["history", "mermaid"],
    ["programming", "shiki"],
    ["general", "html"],
  ];

  it.each(cases)("gives %s a renderer (%s) and always records a non-empty rationale", (subject, expectedRenderer) => {
    const choice = chooseVisualKind(subject, "explanation");
    expect(choice.renderer).toBe(expectedRenderer);
    expect(choice.rationale.length).toBeGreaterThan(10);
  });

  it("is deterministic: the same (subject, beat) pair always yields the same choice", () => {
    expect(chooseVisualKind("mathematics", "concept-overview")).toEqual(chooseVisualKind("mathematics", "concept-overview"));
  });

  it("gives physics a different visual for a worked example (equation) than for the general explanation (diagram)", () => {
    expect(chooseVisualKind("physics", "example").kind).toBe("equation");
    expect(chooseVisualKind("physics", "explanation").kind).toBe("diagram");
  });
});

describe("scriptConcept", () => {
  const concept: Concept = {
    id: "c1",
    title: "Ohm's Law",
    summary: "V = IR",
    subject: "physics",
    difficulty: 2,
    prerequisiteConceptIds: [],
    timeBudgetSeconds: 300,
    visual: { kind: "diagram", renderer: "mermaid", content: "", rationale: "r" },
    citations: [],
  };

  // scriptConcept fires two INDEPENDENT calls via Promise.all (core teaching: intro+explanation; practice: example+checkpoint+transition).
  // JS dispatches Promise.all's array left-to-right synchronously up to each call's first await, so fetch call order is deterministic: [0] = core, [1] = practice.
  const CORE_PAYLOAD = {
    introductionNarration: "Let's talk about Ohm's Law.",
    explanationNarration: "Think of current like water flow...",
    explanationAnalogyLabel: "water pipe analogy for current",
    explanationVisualContent: "graph TD; V-->I",
    explanationVisualCaption: "Circuit",
  };
  const PRACTICE_PAYLOAD = {
    exampleNarration: "If V=10 and R=2, I=5.",
    exampleVisualContent: "I = 10 / 2 = 5",
    exampleVisualCaption: "Worked example",
    transitionNarration: "Next, let's look at power.",
    checkpointQuestion: {
      type: "mcq",
      prompt: "What happens to current if resistance increases at constant voltage?",
      options: ["It increases", "It decreases", "It stays the same"],
      referenceAnswer: "It decreases",
      difficulty: 2,
    },
    checkpointVisualContent: "graph TD; R-->I",
    checkpointVisualCaption: "Resistance vs current, no worked values",
  };

  it("produces five ordered beats and a checkpoint question, splitting the concept's time budget across them", async () => {
    stubChatSequence(CORE_PAYLOAD, PRACTICE_PAYLOAD);

    const scripted = await scriptConcept({
      concept,
      learnerProfile: { level: "beginner", goal: "pass exam", style: "example-driven", priorKnowledge: "none" },
      language: "en-IN",
    });

    expect(scripted.beats.map((b) => b.type)).toEqual(["introduction", "explanation", "example", "checkpoint", "transition"]);
    expect(scripted.beats.find((b) => b.type === "explanation")?.analogyLabel).toBe("water pipe analogy for current");
    expect(scripted.question.referenceAnswer).toBe("It decreases");

    const totalBeatSeconds = scripted.beats.reduce((sum, b) => sum + b.estimatedSeconds, 0);
    expect(totalBeatSeconds).toBeLessThanOrEqual(concept.timeBudgetSeconds + 25); // rounding + 5s floors per beat
  });

  it("gives the checkpoint its own visual content — never the explanation's derivation", async () => {
    stubChatSequence(CORE_PAYLOAD, PRACTICE_PAYLOAD);

    const scripted = await scriptConcept({
      concept,
      learnerProfile: { level: "beginner", goal: "", style: "", priorKnowledge: "" },
      language: "en-IN",
    });

    const explanationVisual = scripted.beats.find((b) => b.type === "explanation")?.visual?.content;
    const checkpointVisual = scripted.beats.find((b) => b.type === "checkpoint")?.visual?.content;
    expect(checkpointVisual).toBe(PRACTICE_PAYLOAD.checkpointVisualContent);
    expect(checkpointVisual).not.toBe(explanationVisual);
  });

  it("names each beat's own renderer in the prompt, not the concept overview's", async () => {
    const fetchMock = stubChatSequence(CORE_PAYLOAD, PRACTICE_PAYLOAD);

    const scripted = await scriptConcept({
      concept: { ...concept, subject: "programming", visual: { kind: "architecture-diagram", renderer: "mermaid", content: "", rationale: "r" } },
      learnerProfile: { level: "beginner", goal: "", style: "", priorKnowledge: "" },
      language: "en-IN",
    });

    // programming: explanation/example/checkpoint all render as code (shiki), the concept overview as a diagram (mermaid) — not asserted here since scriptConcept never asks about the overview.
    const coreSystemPrompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content as string;
    const practiceSystemPrompt = JSON.parse(fetchMock.mock.calls[1][1].body).messages[0].content as string;
    expect(coreSystemPrompt).toContain('explanationVisualContent is rendered by "shiki"');
    expect(practiceSystemPrompt).toContain('exampleVisualContent is rendered by "shiki"');
    expect(practiceSystemPrompt).toContain('checkpointVisualContent is rendered by "shiki"');
    expect(coreSystemPrompt).not.toContain('renderer is "mermaid"');
    expect(scripted.beats.find((b) => b.type === "example")?.visual?.renderer).toBe("shiki");
    expect(scripted.beats.find((b) => b.type === "checkpoint")?.visual?.renderer).toBe("shiki");
  });
});
