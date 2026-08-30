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

  it("produces five ordered beats and a checkpoint question, splitting the concept's time budget across them", async () => {
    stubChatSequence({
      introductionNarration: "Let's talk about Ohm's Law.",
      explanationNarration: "Think of current like water flow...",
      explanationAnalogyLabel: "water pipe analogy for current",
      explanationVisualContent: "graph TD; V-->I",
      explanationVisualCaption: "Circuit",
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
    });

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

  it("names each beat's own renderer in the prompt, not the concept overview's", async () => {
    const fetchMock = stubChatSequence({
      introductionNarration: "i",
      explanationNarration: "e",
      explanationAnalogyLabel: "pipeline analogy",
      explanationVisualContent: "graph TD; A-->B",
      explanationVisualCaption: "c",
      exampleNarration: "x",
      exampleVisualContent: "const x = 1;",
      exampleVisualCaption: "c",
      transitionNarration: "t",
      checkpointQuestion: { type: "short-answer", prompt: "p", options: null, referenceAnswer: "a", difficulty: 3 },
    });

    const scripted = await scriptConcept({
      concept: { ...concept, subject: "programming", visual: { kind: "architecture-diagram", renderer: "mermaid", content: "", rationale: "r" } },
      learnerProfile: { level: "beginner", goal: "", style: "", priorKnowledge: "" },
      language: "en-IN",
    });

    // programming: explanation renders as code (shiki), the concept overview as a diagram (mermaid).
    const systemPrompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content as string;
    expect(systemPrompt).toContain('explanationVisualContent is rendered by "shiki"');
    expect(systemPrompt).toContain('exampleVisualContent is rendered by "shiki"');
    expect(systemPrompt).not.toContain('renderer is "mermaid"');
    expect(scripted.beats.find((b) => b.type === "example")?.visual?.renderer).toBe("shiki");
  });
});
