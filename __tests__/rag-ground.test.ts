import { describe, expect, it } from "vitest";
import { DENSE_RELEVANCE_THRESHOLD, isRelevant } from "../lib/rag/ground";
import type { RetrievedChunk } from "../lib/rag/retrieve";
import type { DocumentChunkRow } from "../lib/db/types";

function chunk(id: string): DocumentChunkRow {
  return { id, documentId: "doc-1", order: 0, text: "text", page: null, section: null, embedding: null, createdAt: "now" };
}

function retrieved(denseScore: number): RetrievedChunk {
  return { chunk: chunk("c1"), score: 1, denseScore, lexicalScore: 0 };
}

describe("isRelevant — the anti-hallucination gate", () => {
  it("is false when nothing was retrieved", () => {
    expect(isRelevant([])).toBe(false);
  });

  it("is false when the best match's cosine similarity is below the threshold", () => {
    expect(isRelevant([retrieved(DENSE_RELEVANCE_THRESHOLD - 0.01)])).toBe(false);
  });

  it("is true when the best match's cosine similarity meets the threshold", () => {
    expect(isRelevant([retrieved(DENSE_RELEVANCE_THRESHOLD)])).toBe(true);
  });

  it("looks at the best match, not the average", () => {
    const results = [retrieved(0.9), retrieved(0.01), retrieved(0.0)];
    expect(isRelevant(results)).toBe(true);
  });

  it("looks past retrieved[0] — RRF order can rank a weaker dense match first", () => {
    const results = [retrieved(DENSE_RELEVANCE_THRESHOLD - 0.02), retrieved(0.55)];
    expect(isRelevant(results)).toBe(true);
  });
});
