import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubChatSequence } from "./support/sarvamMock";
import { deriveStructure, filterChunksBySectionHint, planLesson, selectChunksForPlanning } from "../lib/teach/plan";
import type { DocumentChunkRow } from "../lib/db/types";

const ORIGINAL_KEY = process.env.SARVAM_API_KEY;

beforeEach(() => {
  process.env.SARVAM_API_KEY = "test-key";
});

afterEach(() => {
  process.env.SARVAM_API_KEY = ORIGINAL_KEY;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const LEARNER = { level: "beginner" as const, goal: "pass exam", style: "example-driven", priorKnowledge: "none" };

describe("deriveStructure", () => {
  it("gives a 5-minute lesson a single essential concept", () => {
    expect(deriveStructure(5)).toEqual({ bucket: "essential", targetConceptCount: 1, includePracticeConcept: false });
  });

  it("gives a 20-minute lesson several structured concepts with no practice concept", () => {
    const s = deriveStructure(20);
    expect(s.bucket).toBe("structured");
    expect(s.targetConceptCount).toBeGreaterThanOrEqual(2);
    expect(s.includePracticeConcept).toBe(false);
  });

  it("gives a 60-minute lesson a deep structure with a practice concept", () => {
    const s = deriveStructure(60);
    expect(s.bucket).toBe("deep");
    expect(s.includePracticeConcept).toBe(true);
    expect(s.targetConceptCount).toBeGreaterThan(deriveStructure(20).targetConceptCount);
  });
});

describe("planLesson — dependency sequencing", () => {
  it("orders concepts so a prerequisite always precedes the concept that depends on it, even when the model lists them out of order", async () => {
    stubChatSequence({
      concepts: [
        {
          title: "Ohm's Law",
          summary: "V = IR",
          subject: "physics",
          difficulty: 3,
          prerequisiteTitles: ["Current", "Voltage"],
          citedChunkIndices: null,
          visualContent: "V = IR",
          visualCaption: "Ohm's Law",
        },
        {
          title: "Voltage",
          summary: "Electric potential difference.",
          subject: "physics",
          difficulty: 1,
          prerequisiteTitles: [],
          citedChunkIndices: null,
          visualContent: "V",
          visualCaption: "Voltage",
        },
        {
          title: "Current",
          summary: "Flow of charge.",
          subject: "physics",
          difficulty: 1,
          prerequisiteTitles: [],
          citedChunkIndices: null,
          visualContent: "I",
          visualCaption: "Current",
        },
      ],
    });

    const concepts = await planLesson({
      topic: "Electricity",
      learnerProfile: LEARNER,
      language: "en-IN",
      totalMinutes: 20,
      depth: "standard",
    });

    const titles = concepts.map((c) => c.title);
    expect(titles.indexOf("Ohm's Law")).toBeGreaterThan(titles.indexOf("Current"));
    expect(titles.indexOf("Ohm's Law")).toBeGreaterThan(titles.indexOf("Voltage"));

    const totalSeconds = concepts.reduce((sum, c) => sum + c.timeBudgetSeconds, 0);
    expect(totalSeconds).toBeLessThanOrEqual(20 * 60);
  });

  it("breaks a cycle instead of hanging or throwing", async () => {
    stubChatSequence({
      concepts: [
        {
          title: "A",
          summary: "a",
          subject: "general",
          difficulty: 1,
          prerequisiteTitles: ["B"],
          citedChunkIndices: null,
          visualContent: "x",
          visualCaption: "x",
        },
        {
          title: "B",
          summary: "b",
          subject: "general",
          difficulty: 1,
          prerequisiteTitles: ["A"],
          citedChunkIndices: null,
          visualContent: "x",
          visualCaption: "x",
        },
      ],
    });

    const concepts = await planLesson({
      topic: "Cyclic",
      learnerProfile: LEARNER,
      language: "en-IN",
      totalMinutes: 10,
      depth: "standard",
    });

    expect(concepts.map((c) => c.title).sort()).toEqual(["A", "B"]);
  });

  it("builds citations from the real chunk text, not from model-invented excerpts", async () => {
    const chunks: DocumentChunkRow[] = [
      { id: "chunk-1", documentId: "doc-1", order: 0, text: "Newton's first law: an object at rest stays at rest.", page: 4, section: "Chapter 4", createdAt: "now" },
      { id: "chunk-2", documentId: "doc-1", order: 1, text: "Newton's second law: F = ma.", page: 5, section: "Chapter 4", createdAt: "now" },
    ];

    stubChatSequence({
      concepts: [
        {
          title: "Newton's First Law",
          summary: "Inertia.",
          subject: "physics",
          difficulty: 2,
          prerequisiteTitles: [],
          citedChunkIndices: [0],
          visualContent: "F = 0 => a = 0",
          visualCaption: "Inertia",
        },
      ],
    });

    const concepts = await planLesson({
      topic: "Newton's Laws",
      learnerProfile: LEARNER,
      language: "en-IN",
      totalMinutes: 10,
      depth: "standard",
      sourceDocumentId: "doc-1",
      sourceChunks: chunks,
    });

    expect(concepts[0].citations).toEqual([
      { documentId: "doc-1", chunkId: "chunk-1", page: 4, section: "Chapter 4", excerpt: chunks[0].text },
    ]);
  });
});

describe("filterChunksBySectionHint / selectChunksForPlanning", () => {
  const chunks: DocumentChunkRow[] = [
    { id: "1", documentId: "d", order: 0, text: "intro", page: 1, section: "Chapter 1", createdAt: "now" },
    { id: "2", documentId: "d", order: 1, text: "a".repeat(100), page: 4, section: "Chapter 4", createdAt: "now" },
    { id: "3", documentId: "d", order: 2, text: "more chapter 4 text", page: 5, section: "Chapter 4", createdAt: "now" },
  ];

  it("narrows to the matching section when a hint is given", () => {
    const filtered = filterChunksBySectionHint(chunks, "Chapter 4");
    expect(filtered.map((c) => c.id)).toEqual(["2", "3"]);
  });

  it("falls back to all chunks when nothing matches the hint", () => {
    expect(filterChunksBySectionHint(chunks, "Chapter 99")).toEqual(chunks);
  });

  it("caps total characters sent to the model", () => {
    const selected = selectChunksForPlanning(chunks, 50);
    expect(selected.length).toBeLessThan(chunks.length);
  });
});
