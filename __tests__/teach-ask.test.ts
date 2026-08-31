import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubChatSequence } from "./support/sarvamMock";
import { answerFollowUpQuestion, lexicalScore, retrieveRelevantChunks } from "../lib/teach/ask";
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

const CHUNKS: DocumentChunkRow[] = [
  { id: "1", documentId: "d", order: 0, text: "Ohm's Law states that voltage equals current times resistance.", page: 4, section: "Chapter 4", createdAt: "now" },
  { id: "2", documentId: "d", order: 1, text: "Photosynthesis converts sunlight into chemical energy in plants.", page: 12, section: "Chapter 9", createdAt: "now" },
];

/** A single-subject document, mirroring the photosynthesis-only material from the live off-document failure. */
const PHOTOSYNTHESIS_CHUNKS: DocumentChunkRow[] = [
  { id: "p1", documentId: "p", order: 0, text: "Photosynthesis takes place in the chloroplasts of plant cells, which contain the green pigment chlorophyll.", page: 1, section: "4.1 Where it happens", createdAt: "now" },
  { id: "p2", documentId: "p", order: 1, text: "In the thylakoid membranes, absorbed light splits water molecules, and the energy is captured as ATP and NADPH.", page: 2, section: "4.2 Light-dependent reactions", createdAt: "now" },
  { id: "p3", documentId: "p", order: 2, text: "In the stroma, the Calvin cycle uses ATP and NADPH to fix carbon dioxide into a three-carbon sugar.", page: 3, section: "4.3 The Calvin cycle", createdAt: "now" },
];

describe("lexicalScore / retrieveRelevantChunks", () => {
  it("scores a chunk sharing the query's terms higher than an unrelated one", () => {
    const relevant = lexicalScore("what is Ohm's Law about resistance", CHUNKS[0].text);
    const irrelevant = lexicalScore("what is Ohm's Law about resistance", CHUNKS[1].text);
    expect(relevant).toBeGreaterThan(irrelevant);
  });

  it("returns nothing when no chunk clears the relevance floor", () => {
    expect(retrieveRelevantChunks("something entirely unrelated to any of this xyzzy", CHUNKS)).toEqual([]);
  });

  it("does not clear the floor on shared stopwords alone", () => {
    // "Who won the 1998 football world cup?" shares only "the" with ordinary prose.
    // Before stopword filtering that alone scored ~0.10 and cleared the floor.
    expect(retrieveRelevantChunks("Who won the 1998 football world cup?", PHOTOSYNTHESIS_CHUNKS)).toEqual([]);
    expect(retrieveRelevantChunks("What is the capital of France?", PHOTOSYNTHESIS_CHUNKS)).toEqual([]);
    expect(lexicalScore("Who won the 1998 football world cup?", PHOTOSYNTHESIS_CHUNKS[0].text)).toBe(0);
  });

  it("retrieves the matching chunk for an on-topic question", () => {
    const results = retrieveRelevantChunks("explain Ohm's Law voltage resistance", CHUNKS);
    expect(results[0]?.id).toBe("1");
  });
});

describe("answerFollowUpQuestion", () => {
  it("grounds the answer and cites the real chunk when material is relevant", async () => {
    stubChatSequence({ requestedLanguage: null }, { answer: "Ohm's Law: V = IR." });

    const result = await answerFollowUpQuestion({
      question: "What does Ohm's Law say?",
      lessonTopic: "Electricity",
      sourceDocumentId: "d",
      documentChunks: CHUNKS,
      language: "en-IN",
      learnerProfile: { level: "beginner" },
    });

    expect(result.grounded).toBe(true);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].chunkId).toBe("1");
    expect(result.citations[0].excerpt).toBe(CHUNKS[0].text.slice(0, 240));
  });

  it("says so rather than inventing an answer when nothing in the material is relevant", async () => {
    stubChatSequence(
      { requestedLanguage: null },
      { answer: "This isn't covered in the uploaded material — but generally, tectonic plates..." },
    );

    const result = await answerFollowUpQuestion({
      question: "What causes earthquakes?",
      lessonTopic: "Electricity",
      sourceDocumentId: "d",
      documentChunks: CHUNKS,
      language: "en-IN",
      learnerProfile: { level: "beginner" },
    });

    expect(result.grounded).toBe(false);
    expect(result.citations).toEqual([]);
  });

  it("reports grounded:false with no citations for an off-topic question about a single-subject document", async () => {
    // The exact case that regressed live: against a photosynthesis-only document this
    // returned grounded:true with 3 irrelevant citations, because the stopword "the"
    // alone cleared the relevance floor.
    stubChatSequence(
      { requestedLanguage: null },
      { answer: "That isn't covered in your material, but generally: France won the 1998 World Cup." },
    );

    const result = await answerFollowUpQuestion({
      question: "Who won the 1998 football world cup?",
      lessonTopic: "Photosynthesis",
      sourceDocumentId: "p",
      documentChunks: PHOTOSYNTHESIS_CHUNKS,
      language: "en-IN",
      learnerProfile: { level: "beginner" },
    });

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

    expect(result.languageSwitchRequested).toBe("hi-IN");
    expect(result.answer).toContain("Hindi");
  });
});
