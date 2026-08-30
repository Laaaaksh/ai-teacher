/**
 * "Plan" — turns a topic (bare, or grounded in an uploaded document's real
 * outline) into an ordered Concept[] with a per-concept time budget.
 *
 * The available time changes lesson *structure*, not just length:
 *   - <= 7 min:  the single essential idea only.
 *   - <= 25 min: a structured lesson, several concepts, each with an example.
 *   - <= 90 min: a deep lesson — more concepts, plus an explicit practice/
 *                consolidation concept before the final assessment.
 *   - beyond that (or an explicit multi-day request) is not this module's
 *     job — see lib/teach/path.ts, which spaces a topic across sessions and
 *     calls this planner once per session.
 *
 * Concepts are sequenced by dependency (Ohm's Law never precedes current and
 * voltage): the model proposes prerequisites by title, and a topological
 * sort here — not the model — is what actually guarantees the final order
 * respects them, breaking any cycle the model introduces rather than
 * trusting it blindly.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { json } from "./llm";
import { languageInstruction } from "./profile";
import { chooseVisualKind } from "./script";
import type { ConceptProgressRow, DocumentChunkRow, LearnerProfileRow } from "../db/types";
import type { Citation, Concept, LanguageCode, LearningDepth, Subject } from "../types";

// ---------------------------------------------------------------------------
// Time -> structure
// ---------------------------------------------------------------------------

export type LessonBucket = "essential" | "structured" | "deep";

export interface LessonStructure {
  bucket: LessonBucket;
  targetConceptCount: number;
  /** Deep lessons get an explicit practice/consolidation concept ahead of the final assessment; essential/structured don't have the time budget for one. */
  includePracticeConcept: boolean;
}

export function deriveStructure(totalMinutes: number): LessonStructure {
  if (totalMinutes <= 7) {
    return { bucket: "essential", targetConceptCount: 1, includePracticeConcept: false };
  }
  if (totalMinutes <= 25) {
    return { bucket: "structured", targetConceptCount: clamp(Math.round(totalMinutes / 6), 2, 5), includePracticeConcept: false };
  }
  return { bucket: "deep", targetConceptCount: clamp(Math.round(totalMinutes / 9), 4, 10), includePracticeConcept: true };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// ---------------------------------------------------------------------------
// Grounding: trimming an uploaded document down to a plannable outline
// ---------------------------------------------------------------------------

const MAX_PLANNING_CHARS = 16_000;

/** "Teach me Chapter 4" — narrows to sections whose title mentions the hint before falling back to the whole document. */
export function filterChunksBySectionHint(chunks: DocumentChunkRow[], hint?: string): DocumentChunkRow[] {
  if (!hint?.trim()) return chunks;
  const needle = hint.trim().toLowerCase();
  const matched = chunks.filter((c) => c.section?.toLowerCase().includes(needle));
  return matched.length > 0 ? matched : chunks;
}

/** Caps total characters sent to the model so a large document doesn't blow the prompt budget; keeps document order. */
export function selectChunksForPlanning(chunks: DocumentChunkRow[], maxChars = MAX_PLANNING_CHARS): DocumentChunkRow[] {
  const selected: DocumentChunkRow[] = [];
  let total = 0;
  for (const chunk of chunks) {
    if (total + chunk.text.length > maxChars && selected.length > 0) break;
    selected.push(chunk);
    total += chunk.text.length;
  }
  return selected;
}

// ---------------------------------------------------------------------------
// LLM: propose concepts
// ---------------------------------------------------------------------------

const SUBJECTS = ["mathematics", "physics", "biology", "chemistry", "history", "programming", "general"] as const satisfies readonly Subject[];

const ConceptDraftSchema = z.object({
  title: z.string(),
  summary: z.string(),
  subject: z.enum(SUBJECTS),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  /** Titles of other concepts IN THIS SAME LIST that must be taught first. */
  prerequisiteTitles: z.array(z.string()),
  /** Indices into the provided source excerpts this concept is grounded in; null/empty when teaching from general knowledge. */
  citedChunkIndices: z.array(z.number().int()).nullable(),
  visualContent: z.string(),
  visualCaption: z.string(),
});

const PlanDraftSchema = z.object({ concepts: z.array(ConceptDraftSchema) });

export interface PlanLessonInput {
  topic: string;
  learnerProfile: Pick<LearnerProfileRow, "level" | "goal" | "style" | "priorKnowledge">;
  language: LanguageCode;
  totalMinutes: number;
  depth: LearningDepth;
  /** Present when the lesson is grounded in uploaded material. */
  sourceDocumentId?: string;
  sourceChunks?: DocumentChunkRow[];
  /** Section/chapter hint from the instruction ("Chapter 4"), used to narrow sourceChunks before planning. */
  sectionHint?: string;
  /** From a prior session with this learner, so a second session is genuinely personalised by the first. */
  priorProgress?: ConceptProgressRow[];
}

export async function planLesson(input: PlanLessonInput): Promise<Concept[]> {
  const structure = deriveStructure(input.totalMinutes);

  const groundingChunks = input.sourceChunks
    ? selectChunksForPlanning(filterChunksBySectionHint(input.sourceChunks, input.sectionHint))
    : [];
  const grounded = groundingChunks.length > 0;

  const progressNote = describePriorProgress(input.priorProgress);

  const draft = await json(PlanDraftSchema, {
    messages: [
      {
        role: "system",
        content:
          `You are planning a lesson for a ${input.learnerProfile.level} learner. Goal: ${input.learnerProfile.goal || "general understanding"}. ` +
          `Preferred style: ${input.learnerProfile.style || "clear and direct"}. Prior knowledge: ${input.learnerProfile.priorKnowledge || "none stated"}. ${progressNote}` +
          `\n\nProduce exactly ${structure.targetConceptCount} concepts (bucket: ${structure.bucket}) that together fit a ${input.totalMinutes}-minute lesson on "${input.topic}". ` +
          "Order does not matter in your output — sequence concepts by dependency using prerequisiteTitles (list ONLY titles that appear elsewhere in your own output); the caller will topologically sort. " +
          (structure.includePracticeConcept
            ? "Because this is a deep, longer lesson, make the LAST concept an explicit practice/consolidation concept that ties the earlier ones together. "
            : "") +
          (grounded
            ? "Ground every concept in the numbered source excerpts below — set citedChunkIndices to the excerpt numbers it draws from. Do not invent content the excerpts don't support."
            : "No material was uploaded; teach this topic from general knowledge and leave citedChunkIndices null.") +
          ` ${languageInstruction(input.language)} (title, summary and visualCaption too — the source excerpts above may be in a different language than this; translate/teach across that gap, don't just copy their language.)` +
          `\n\nRespond with ONLY a JSON object of exactly this shape (no other keys, no markdown fences):\n` +
          `{"concepts": [{"title": string, "summary": string (one paragraph), "subject": one of "mathematics"|"physics"|"biology"|"chemistry"|"history"|"programming"|"general", ` +
          `"difficulty": integer 1-5, "prerequisiteTitles": string[], "citedChunkIndices": number[] or null, "visualContent": string (renderer source, e.g. LaTeX/Mermaid/code illustrating this concept), "visualCaption": string}]}`,
      },
      {
        role: "user",
        content: grounded
          ? groundingChunks.map((c, i) => `[${i}] (${c.section ?? `page ${c.page ?? "?"}`}) ${c.text}`).join("\n\n")
          : `Topic: ${input.topic}`,
      },
    ],
    temperature: 0.5,
  });

  const withIds = draft.concepts.map((c) => ({ ...c, id: randomUUID() as string }));
  const byTitle = new Map(withIds.map((c) => [c.title.trim().toLowerCase(), c]));

  const resolved = withIds.map((c) => ({
    ...c,
    prerequisiteConceptIds: c.prerequisiteTitles
      .map((t) => byTitle.get(t.trim().toLowerCase())?.id)
      .filter((id): id is string => Boolean(id) && id !== c.id),
  }));

  const orderedIds = topologicalOrder(resolved);
  const byId = new Map(resolved.map((c) => [c.id, c]));
  const ordered = orderedIds.map((id) => byId.get(id)!);

  const totalWeight = ordered.reduce((sum, c) => sum + c.difficulty, 0) || ordered.length;
  const totalSeconds = input.totalMinutes * 60;

  return ordered.map((c) => {
    const visualChoice = chooseVisualKind(c.subject, "concept-overview");
    const citations: Citation[] = grounded
      ? (c.citedChunkIndices ?? [])
          .map((i) => groundingChunks[i])
          .filter((chunk): chunk is DocumentChunkRow => Boolean(chunk))
          .map((chunk) => ({
            documentId: input.sourceDocumentId!,
            chunkId: chunk.id,
            page: chunk.page ?? undefined,
            section: chunk.section ?? undefined,
            excerpt: chunk.text.slice(0, 240),
          }))
      : [];

    return {
      id: c.id,
      title: c.title,
      summary: c.summary,
      subject: c.subject,
      difficulty: c.difficulty,
      prerequisiteConceptIds: c.prerequisiteConceptIds,
      timeBudgetSeconds: Math.max(60, Math.round((totalSeconds * c.difficulty) / totalWeight)),
      visual: {
        kind: visualChoice.kind,
        renderer: visualChoice.renderer,
        content: c.visualContent,
        caption: c.visualCaption,
        rationale: visualChoice.rationale,
      },
      citations,
    } satisfies Concept;
  });
}

function describePriorProgress(priorProgress?: ConceptProgressRow[]): string {
  if (!priorProgress?.length) return "";
  const mastered = priorProgress.filter((p) => p.mastery === "mastered" || p.mastery === "proficient").map((p) => p.conceptTitle);
  const weak = priorProgress.filter((p) => p.mastery === "struggling" || p.mastery === "developing").map((p) => p.conceptTitle);
  const parts: string[] = [];
  if (mastered.length) parts.push(`Already mastered from a prior session (cover briefly, don't re-teach from scratch): ${mastered.join(", ")}.`);
  if (weak.length) parts.push(`Previously weak, reinforce if relevant here: ${weak.join(", ")}.`);
  return parts.length ? ` ${parts.join(" ")}` : "";
}

/**
 * Kahn/DFS topological sort over prerequisiteConceptIds. A "visiting" node
 * revisited mid-DFS means the model produced a cycle; that back-edge is
 * silently dropped (not the whole concept) so planning always terminates
 * with a valid order instead of trusting the model's edges blindly.
 */
function topologicalOrder(concepts: { id: string; prerequisiteConceptIds: string[] }[]): string[] {
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const byId = new Map(concepts.map((c) => [c.id, c]));

  function visit(id: string) {
    if (state.get(id) === "done" || state.get(id) === "visiting") return;
    state.set(id, "visiting");
    for (const dep of byId.get(id)?.prerequisiteConceptIds ?? []) {
      if (byId.has(dep)) visit(dep);
    }
    state.set(id, "done");
    order.push(id);
  }

  for (const c of concepts) visit(c.id);
  return order;
}
