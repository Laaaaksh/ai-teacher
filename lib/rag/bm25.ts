/**
 * Okapi BM25 lexical scoring over a small in-memory corpus (one document's
 * chunks — at most a few thousand for a 300-page book, so recomputing the
 * index per query is cheap and avoids persisting a second index alongside
 * the vector one). Catches exact-term matches ("Ohm's Law") that a dense
 * embedding can blur into nearby-but-wrong concepts.
 */

const K1 = 1.5;
const B = 0.75;

export interface BM25Doc {
  id: string;
  text: string;
}

/**
 * Lowercases and splits on non-word boundaries (Unicode-aware, so
 * Devanagari/Bengali/Tamil/etc. tokenize too), dropping single-character
 * tokens as noise. Includes \p{M} (combining marks) alongside \p{L}
 * (letters) — Indic vowel signs (matras) are Unicode Mark category, not
 * Letter, so a letters-only class would fracture a word like "नियम" at
 * every vowel sign instead of keeping it as one token.
 */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).filter((t) => t.length > 1);
}

interface IndexedDoc {
  id: string;
  termFreq: Map<string, number>;
  length: number;
}

export class Bm25Index {
  private docs: IndexedDoc[];
  private docFreq = new Map<string, number>();
  private avgLength: number;

  constructor(corpus: BM25Doc[]) {
    this.docs = corpus.map((d) => {
      const tokens = tokenize(d.text);
      const termFreq = new Map<string, number>();
      for (const t of tokens) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
      return { id: d.id, termFreq, length: tokens.length };
    });

    for (const doc of this.docs) {
      for (const term of doc.termFreq.keys()) {
        this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
      }
    }

    const totalLength = this.docs.reduce((sum, d) => sum + d.length, 0);
    this.avgLength = this.docs.length > 0 ? totalLength / this.docs.length : 0;
  }

  private idf(term: string): number {
    const n = this.docs.length;
    const df = this.docFreq.get(term) ?? 0;
    // Standard BM25 idf (Robertson-Sparck Jones), floored at a small
    // positive value so a term present in every document still contributes
    // rather than going negative and penalizing an otherwise-relevant chunk.
    return Math.max(0.0001, Math.log((n - df + 0.5) / (df + 0.5) + 1));
  }

  /** Scores every corpus document against `query`, highest first. Documents with zero term overlap are omitted. */
  score(query: string): { id: string; score: number }[] {
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0 || this.docs.length === 0) return [];

    const scores: { id: string; score: number }[] = [];
    for (const doc of this.docs) {
      let score = 0;
      for (const term of queryTerms) {
        const tf = doc.termFreq.get(term);
        if (!tf) continue;
        const idf = this.idf(term);
        const denom = tf + K1 * (1 - B + (B * doc.length) / (this.avgLength || 1));
        score += idf * ((tf * (K1 + 1)) / denom);
      }
      if (score > 0) scores.push({ id: doc.id, score });
    }

    return scores.sort((a, b) => b.score - a.score);
  }
}
