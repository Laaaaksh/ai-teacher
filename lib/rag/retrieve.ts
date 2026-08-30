import { getDocument, getDocumentChunks } from "../db/accessors/documents";
import type { DocumentChunkRow } from "../db/types";
import type { Citation, LanguageCode } from "../types";
import { Bm25Index } from "./bm25";
import { bufferToEmbedding, cosineSimilarity, embedOne } from "./embed";
import { detectLanguage, translateQueryForRetrieval } from "./language";

/**
 * Hybrid retrieval: BM25 lexical scoring fused with dense cosine similarity
 * via Reciprocal Rank Fusion (RRF). RRF (rather than min-max normalizing
 * and weighting the two raw scores) sidesteps the fact that BM25 and cosine
 * similarity live on totally different, corpus-dependent scales — it only
 * needs each method's *rank order*, which is far more stable. `denseScore`
 * (the raw cosine similarity, independent of fusion) is kept on each result
 * specifically so lib/rag/ground.ts can threshold on an interpretable
 * number rather than an RRF rank.
 */

const RRF_K = 60;
const DEFAULT_TOP_K = 6;

export interface RetrievedChunk {
  chunk: DocumentChunkRow;
  /** Fused RRF rank score — use for ordering results, not for a relevance threshold (see denseScore). */
  score: number;
  /** Raw cosine similarity in [-1, 1] (0 if this chunk has no embedding yet, e.g. mid-indexing) — the anti-hallucination threshold lib/rag/ground.ts gates on. */
  denseScore: number;
  /** Raw BM25 score (0 if no lexical term overlap at all). */
  lexicalScore: number;
}

export interface RetrieveOptions {
  documentId: string;
  query: string;
  /** Language the query was asked in; defaults to the document's own language (no translation). */
  queryLanguage?: LanguageCode;
  topK?: number;
}

export async function retrieve(opts: RetrieveOptions): Promise<RetrievedChunk[]> {
  const { documentId, query } = opts;
  const topK = opts.topK ?? DEFAULT_TOP_K;

  const document = getDocument(documentId);
  const chunks = getDocumentChunks(documentId);
  if (chunks.length === 0 || query.trim().length === 0) return [];

  const docLanguage = (document?.language as LanguageCode | null) ?? detectLanguage(chunks[0].text);
  const queryLanguage = opts.queryLanguage ?? docLanguage;
  const effectiveQuery = await translateQueryForRetrieval(query, queryLanguage, docLanguage);

  const bm25 = new Bm25Index(chunks.map((c) => ({ id: c.id, text: c.text })));
  const lexicalRanked = bm25.score(effectiveQuery);
  const lexicalRankById = new Map(lexicalRanked.map((r, i) => [r.id, i]));
  const lexicalScoreById = new Map(lexicalRanked.map((r) => [r.id, r.score]));

  const embedded = chunks.filter((c): c is DocumentChunkRow & { embedding: Buffer } => c.embedding !== null);
  const queryVector = embedded.length > 0 ? await embedOne(effectiveQuery) : undefined;
  const denseScored = queryVector
    ? embedded
        .map((c) => ({ id: c.id, score: cosineSimilarity(queryVector, bufferToEmbedding(c.embedding)) }))
        .sort((a, b) => b.score - a.score)
    : [];
  const denseRankById = new Map(denseScored.map((r, i) => [r.id, i]));
  const denseScoreById = new Map(denseScored.map((r) => [r.id, r.score]));

  const fused: RetrievedChunk[] = chunks.map((chunk) => {
    const lexRank = lexicalRankById.get(chunk.id);
    const denseRank = denseRankById.get(chunk.id);
    const rrfScore = (lexRank !== undefined ? 1 / (RRF_K + lexRank + 1) : 0) + (denseRank !== undefined ? 1 / (RRF_K + denseRank + 1) : 0);
    return {
      chunk,
      score: rrfScore,
      denseScore: denseScoreById.get(chunk.id) ?? 0,
      lexicalScore: lexicalScoreById.get(chunk.id) ?? 0,
    };
  });

  return fused
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** Turns a retrieved chunk row into the citation shape callers (lesson planner, grounding) carry back to the learner. */
export function chunkToCitation(documentId: string, chunk: DocumentChunkRow): Citation {
  return {
    documentId,
    chunkId: chunk.id,
    page: chunk.page ?? undefined,
    section: chunk.section ?? undefined,
    excerpt: chunk.text.length > 240 ? `${chunk.text.slice(0, 240)}…` : chunk.text,
  };
}
