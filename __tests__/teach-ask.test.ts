import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubChatSequence } from "./support/sarvamMock";
import type { DocumentChunkRow } from "../lib/db/types";
import type { RetrievedChunk } from "../lib/rag";

const ORIGINAL_KEY = process.env.SARVAM_API_KEY;

vi.mock("../lib/rag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/rag")>();
  return { ...actual, retrieve: vi.fn() };
});

import { retrieve } from "../lib/rag";
import { answerFollowUpQuestion } from "../lib/teach/ask";

const mockedRetrieve = vi.mocked(retrieve);

beforeEach(() => {
  process.env.SARVAM_API_KEY = "test-key";
  mockedRetrieve.mockReset();
});

afterEach(() => {
  process.env.SARVAM_API_KEY = ORIGINAL_KEY;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function chunk(overrides: Partial<DocumentChunkRow>): DocumentChunkRow {
  return {
    id: "1",
    documentId: "d",
    order: 0,
    text: "Ohm's Law states that voltage equals current times resistance.",
    page: 4,
    section: "Chapter 4",
    embedding: null,
    createdAt: "now",
    ...overrides,
  };
}

/** Above lib/rag/ground.ts's DENSE_RELEVANCE_THRESHOLD (0.32) — a real on-topic match. */
function relevantResult(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return { chunk: chunk({}), score: 1, denseScore: 0.6, lexicalScore: 3, ...overrides };
}

describe("answerFollowUpQuestion", () => {
  it("grounds the answer and cites the real chunk when retrieval clears the relevance gate", async () => {
    mockedRetrieve.mockResolvedValue([relevantResult()]);
    stubChatSequence({ requestedLanguage: null }, { answer: "Ohm's Law: V = IR." });

    const result = await answerFollowUpQuestion({
      question: "What does Ohm's Law say?",
      lessonTopic: "Electricity",
      sourceDocumentId: "d",
      language: "en-IN",
      learnerProfile: { level: "beginner" },
    });

    expect(mockedRetrieve).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "d", query: "What does Ohm's Law say?", queryLanguage: "en-IN" }),
    );
    expect(result.grounded).toBe(true);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].chunkId).toBe("1");
  });

  it("says so rather than inventing an answer when nothing retrieved clears the relevance gate", async () => {
    // denseScore below DENSE_RELEVANCE_THRESHOLD — the real anti-hallucination gate (lib/rag/ground.ts's isRelevant).
    mockedRetrieve.mockResolvedValue([relevantResult({ denseScore: 0.05 })]);
    stubChatSequence(
      { requestedLanguage: null },
      { answer: "This isn't covered in the uploaded material — but generally, tectonic plates..." },
    );

    const result = await answerFollowUpQuestion({
      question: "What causes earthquakes?",
      lessonTopic: "Electricity",
      sourceDocumentId: "d",
      language: "en-IN",
      learnerProfile: { level: "beginner" },
    });

    expect(result.grounded).toBe(false);
    expect(result.citations).toEqual([]);
  });

  it("does not call retrieve when the lesson has no source document", async () => {
    stubChatSequence({ requestedLanguage: null }, { answer: "General knowledge answer." });

    const result = await answerFollowUpQuestion({
      question: "What is gravity?",
      lessonTopic: "Physics",
      language: "en-IN",
      learnerProfile: { level: "beginner" },
    });

    expect(mockedRetrieve).not.toHaveBeenCalled();
    expect(result.grounded).toBe(false);
    expect(result.citations).toEqual([]);
  });

  it("detects a mid-lesson language switch instead of answering as a question", async () => {
    stubChatSequence({ requestedLanguage: "hi-IN" });

    const result = await answerFollowUpQuestion({
      question: "ab hindi mein samjhao",
      lessonTopic: "Electricity",
      language: "en-IN",
      learnerProfile: { level: "beginner" },
    });

    expect(mockedRetrieve).not.toHaveBeenCalled();
    expect(result.languageSwitchRequested).toBe("hi-IN");
    expect(result.answer).toContain("Hindi");
  });
});
