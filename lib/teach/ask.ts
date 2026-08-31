/**
 * The student can interrupt at any point and ask anything — a follow-up
 * question, a "wait, why does that work?", a request to switch language.
 * This answers it grounded in the actual lesson/material and returns; it
 * never touches `lesson_sessions.current_scene_order`, so the caller can
 * resume the lesson exactly where it left off.
 *
 * Grounding goes through the RAG slice's real hybrid retrieval
 * (`lib/rag/retrieve.ts`, BM25 + dense embeddings fused via RRF) and its
 * code-enforced anti-hallucination gate (`isRelevant`, thresholded on raw
 * cosine similarity — see `lib/rag/ground.ts`), the same seam
 * `POST /api/rag/ask` uses. This does NOT hard-refuse off-document
 * questions the way `ground()` does — when nothing clears the relevance
 * gate it says so, then still answers from general knowledge (a real
 * teacher asked something outside the textbook says "that's not in your
 * book, but here's the answer" rather than refusing outright; the spec
 * asks to minimize *unsupported* information, not to refuse everything
 * off-document). The anti-hallucination contract is `FollowUpAnswer.grounded`
 * — a machine-checkable boolean, not the model's own prose — so a caller can
 * always tell a grounded answer from a general-knowledge one regardless of
 * how the model chose to phrase it.
 */
import { json } from "./llm";
import { LANGUAGE_NAMES, detectLanguageSwitch, languageInstruction } from "./profile";
import { chunkToCitation, isRelevant, retrieve, type RetrievedChunk } from "../rag";
import type { LearnerProfileRow } from "../db/types";
import type { Citation, Concept, LanguageCode } from "../types";
import { z } from "zod";

export interface AnswerFollowUpInput {
  question: string;
  lessonTopic: string;
  currentConcept?: Pick<Concept, "title" | "summary">;
  sourceDocumentId?: string;
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

  const retrieved: RetrievedChunk[] = input.sourceDocumentId
    ? await retrieve({ documentId: input.sourceDocumentId, query: input.question, queryLanguage: input.language, topK: 4 })
    : [];
  const grounded = isRelevant(retrieved);

  const context = grounded
    ? `Source material excerpts (use ONLY these facts; if they don't actually answer the question, say so plainly instead of guessing):\n${retrieved
        .map((r, i) => `[${i}] (${r.chunk.section ?? (r.chunk.page ? `page ${r.chunk.page}` : "source")}) ${r.chunk.text}`)
        .join("\n\n")}`
    : input.sourceDocumentId
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

  const citations: Citation[] = grounded ? retrieved.map((r) => chunkToCitation(input.sourceDocumentId!, r.chunk)) : [];

  return { answer, grounded, citations };
}
