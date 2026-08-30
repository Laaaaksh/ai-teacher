/**
 * The student can interrupt at any point and ask anything — a follow-up
 * question, a "wait, why does that work?", a request to switch language.
 * This answers it grounded in the actual lesson/material and returns; it
 * never touches `lesson_sessions.current_scene_order`, so the caller can
 * resume the lesson exactly where it left off.
 *
 * Grounding uses a small local lexical (term-overlap) scorer over the
 * document's chunks rather than the RAG slice's embeddings, which don't
 * exist on this branch (no Sarvam embeddings endpoint; local MiniLM vectors
 * are that slice's job — see docs/ARCHITECTURE.md). This does NOT hard-refuse
 * off-document questions — when nothing scores above the relevance floor it
 * says so, then still answers from general knowledge (a real teacher asked
 * something outside the textbook says "that's not in your book, but here's
 * the answer" rather than refusing outright; the spec asks to minimize
 * *unsupported* information, not to refuse everything off-document). The
 * anti-hallucination contract is `FollowUpAnswer.grounded` — a
 * machine-checkable boolean, not the model's own prose — so a caller can
 * always tell a grounded answer from a general-knowledge one regardless of
 * how the model chose to phrase it.
 */
import { json } from "./llm";
import { LANGUAGE_NAMES, detectLanguageSwitch, languageInstruction } from "./profile";
import type { DocumentChunkRow, LearnerProfileRow } from "../db/types";
import type { Citation, Concept, LanguageCode } from "../types";
import { z } from "zod";

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Normalized term-overlap score, roughly comparable across chunks of different length — not BM25, but enough to rank and to threshold "nothing relevant". */
export function lexicalScore(query: string, text: string): number {
  const queryTerms = new Set(tokenize(query));
  const textTerms = tokenize(text);
  if (queryTerms.size === 0 || textTerms.length === 0) return 0;

  const freq = new Map<string, number>();
  for (const t of textTerms) freq.set(t, (freq.get(t) ?? 0) + 1);

  let score = 0;
  for (const term of queryTerms) {
    const count = freq.get(term) ?? 0;
    if (count > 0) score += count / Math.sqrt(textTerms.length);
  }
  return score / queryTerms.size;
}

const RELEVANCE_FLOOR = 0.05;
const TOP_K = 4;

export function retrieveRelevantChunks(question: string, chunks: DocumentChunkRow[], topK = TOP_K): DocumentChunkRow[] {
  return chunks
    .map((chunk) => ({ chunk, score: lexicalScore(question, chunk.text) }))
    .filter((s) => s.score >= RELEVANCE_FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => s.chunk);
}

export interface AnswerFollowUpInput {
  question: string;
  lessonTopic: string;
  currentConcept?: Pick<Concept, "title" | "summary">;
  sourceDocumentId?: string;
  documentChunks?: DocumentChunkRow[];
  language: LanguageCode;
  learnerProfile: Pick<LearnerProfileRow, "level">;
}

export interface FollowUpAnswer {
  answer: string;
  /**
   * True only when the answer was actually grounded in retrieved source
   * excerpts (see `citations`). This — not the wording of `answer` — is the
   * authoritative, machine-checkable signal a UI must render the "not from
   * your material" disclaimer from: computed from retrieval results in code,
   * never from the model's own claim about itself.
   */
  grounded: boolean;
  citations: Citation[];
  /** Set when the message was actually a mid-lesson language-switch request; `answer` is then just the acknowledgement, not a QA response. */
  languageSwitchRequested?: LanguageCode;
}

const AnswerSchema = z.object({ answer: z.string() });

export async function answerFollowUpQuestion(input: AnswerFollowUpInput): Promise<FollowUpAnswer> {
  const switchTo = await detectLanguageSwitch(input.question, input.language);
  if (switchTo) {
    return {
      answer: `Sure — switching to ${LANGUAGE_NAMES[switchTo]} now.`,
      grounded: true,
      citations: [],
      languageSwitchRequested: switchTo,
    };
  }

  const relevantChunks = input.documentChunks?.length ? retrieveRelevantChunks(input.question, input.documentChunks) : [];
  const grounded = relevantChunks.length > 0;

  const context = grounded
    ? `Source material excerpts (use ONLY these facts; if they don't actually answer the question, say so plainly instead of guessing):\n${relevantChunks
        .map((c, i) => `[${i}] (${c.section ?? `page ${c.page ?? "?"}`}) ${c.text}`)
        .join("\n\n")}`
    : input.documentChunks?.length
      ? "No part of the uploaded material scores as relevant to this question — say plainly that it isn't covered in the uploaded material, then answer from general knowledge if you can, clearly labelled as general knowledge, not from the material."
      : "This lesson has no uploaded material; answer from general knowledge.";

  const { answer } = await json(AnswerSchema, {
    messages: [
      {
        role: "system",
        content:
          `The student is mid-lesson on "${input.lessonTopic}"${input.currentConcept ? `, currently on the concept "${input.currentConcept.title}" (${input.currentConcept.summary})` : ""}. ` +
          `They've interrupted with a question. Answer it directly and concisely for a ${input.learnerProfile.level} learner, then they'll return to the lesson. ` +
          `${languageInstruction(input.language)} ${context} ` +
          `\n\nRespond with ONLY a JSON object of exactly this shape: {"answer": string}`,
      },
      { role: "user", content: input.question },
    ],
    temperature: 0.3,
  });

  const citations: Citation[] = grounded
    ? relevantChunks.map((chunk) => ({
        documentId: input.sourceDocumentId!,
        chunkId: chunk.id,
        page: chunk.page ?? undefined,
        section: chunk.section ?? undefined,
        excerpt: chunk.text.slice(0, 240),
      }))
    : [];

  return { answer, grounded, citations };
}
