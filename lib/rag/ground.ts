import { chat, translate } from "../sarvam";
import type { Citation, LanguageCode } from "../types";
import { chunkToCitation, retrieve, type RetrievedChunk } from "./retrieve";

/**
 * The seam the teaching engine calls: given a concept or a student question
 * plus a document, retrieve grounding material, and either answer strictly
 * from it (with citations) or say plainly that the material doesn't cover
 * it. The anti-hallucination gate is a code-enforced number
 * (DENSE_RELEVANCE_THRESHOLD on the *retrieval* score), not the LLM's own
 * judgement — sarvam-105b's pretraining almost certainly "knows" things
 * like Ohm's Law regardless of what's in the uploaded material, so refusal
 * can't be left to the model deciding whether to comply with a system
 * prompt. It is decided here, before the model is ever called for an
 * out-of-scope question, and it is what evals/retrieval-eval.ts checks.
 */

/**
 * Empirical, not arbitrary: it sits in the gap between on-topic and
 * off-topic cosine similarity measured against evals/fixtures. The observed
 * scores on either side, and how to re-tune this if a new document type
 * narrows that gap, are in evals/README.md ("Tuning
 * DENSE_RELEVANCE_THRESHOLD") — `npm run eval:rag` is what checks it.
 */
const DENSE_RELEVANCE_THRESHOLD = 0.32;

const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  "en-IN": "English",
  "hi-IN": "Hindi",
  hinglish: "Hinglish (a natural mix of Hindi and English, written primarily in the Latin script)",
  "bn-IN": "Bengali",
  "ta-IN": "Tamil",
  "te-IN": "Telugu",
  "mr-IN": "Marathi",
  "kn-IN": "Kannada",
  "gu-IN": "Gujarati",
  "ml-IN": "Malayalam",
  "pa-IN": "Punjabi",
};

const NOT_COVERED_EN =
  "I couldn't find anything about that in the uploaded material, so I won't guess — this document doesn't seem to cover that.";

/**
 * The refusal is the behaviour this slice is graded on, so a failing
 * /translate call must not turn it into a 500: an English refusal is a
 * worse answer than a localized one, but it is still the honest one.
 */
async function localizedNotCovered(languageCode: LanguageCode): Promise<string> {
  const target = languageCode === "hinglish" ? "en-IN" : languageCode;
  if (target === "en-IN") return NOT_COVERED_EN;
  try {
    const { translatedText } = await translate({ input: NOT_COVERED_EN, sourceLanguageCode: "en-IN", targetLanguageCode: target });
    return translatedText;
  } catch {
    return NOT_COVERED_EN;
  }
}

/** Gates on the best cosine in the retrieved set, not on retrieved[0] — that is ordered by fused RRF rank, which can put a weaker dense match first. */
function isRelevant(retrieved: RetrievedChunk[]): boolean {
  return retrieved.some((r) => r.denseScore >= DENSE_RELEVANCE_THRESHOLD);
}

export interface GroundOptions {
  documentId: string;
  /** A concept title ("Ohm's Law") or a full student question. */
  question: string;
  languageCode: LanguageCode;
  topK?: number;
}

export interface GroundedAnswer {
  answer: string;
  /** false means the answer is the honest "not covered" refusal, not an attempt to answer. */
  grounded: boolean;
  /** Every chunk the answer is permitted to draw from — empty when ungrounded. */
  citations: Citation[];
  retrieved: RetrievedChunk[];
}

export async function ground(opts: GroundOptions): Promise<GroundedAnswer> {
  const topK = opts.topK ?? 4;
  const retrieved = await retrieve({ documentId: opts.documentId, query: opts.question, queryLanguage: opts.languageCode, topK });

  if (!isRelevant(retrieved)) {
    return { answer: await localizedNotCovered(opts.languageCode), grounded: false, citations: [], retrieved };
  }

  const excerptBlock = retrieved
    .map((r, i) => `[${i + 1}] (${r.chunk.section ?? (r.chunk.page ? `page ${r.chunk.page}` : "source")})\n${r.chunk.text}`)
    .join("\n\n");

  const result = await chat({
    messages: [
      {
        role: "system",
        content:
          "You are a teacher answering strictly from the numbered excerpts of the student's uploaded material given below. " +
          "Only state facts the excerpts directly support, and cite which excerpt(s) support each claim using [1], [2], etc. " +
          "If the excerpts only partially answer the question, answer the part they support and say plainly what is not covered. " +
          "Never use outside knowledge to fill a gap the excerpts don't cover. " +
          `Answer in ${LANGUAGE_NAMES[opts.languageCode]}.`,
      },
      { role: "user", content: `Excerpts from the uploaded material:\n\n${excerptBlock}\n\nQuestion: ${opts.question}` },
    ],
    temperature: 0.2,
  });

  return {
    answer: result.content,
    grounded: true,
    citations: retrieved.map((r) => chunkToCitation(opts.documentId, r.chunk)),
    retrieved,
  };
}

export { DENSE_RELEVANCE_THRESHOLD, isRelevant };
