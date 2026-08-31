/**
 * Orchestrates Plan -> Explain/Demonstrate/Question -> persistence, split
 * into a FAST phase and a BACKGROUND phase so a caller isn't blocked on the
 * whole lesson being scripted.
 *
 * Verified live: scripting was previously one sequential LLM call per
 * concept plus planning plus a summary — for a multi-concept lesson this
 * took minutes in a single HTTP request and, before the token-budget fix in
 * lib/sarvam/config.ts, could fail outright partway through. `planTaught
 * LessonSession()` does only the planning call (verified live: ~50s for a
 * 3-concept lesson) and persists the
 * session/plan/concepts immediately; `scriptTaughtLessonSession()` scripts
 * concepts CONCURRENTLY but with a bounded pool, not a sequential loop and
 * not an unbounded fan-out — the calls are independent, so they overlap,
 * but only `MAX_CONCURRENT_CONCEPT_SCRIPTS` at a time so a long plan can't
 * put every concept's pair of large requests on the wire at once. It is
 * meant to be run in the background by
 * the caller (see app/api/teach/sessions/route.ts), with progress polled
 * via `lesson_sessions.scripting_status`.
 *
 * A single concept's scripting failure no longer fails the whole lesson:
 * `scriptTaughtLessonSession` isolates failures per concept and marks the
 * session 'partial' rather than losing everything already scripted.
 */
import {
  createLessonPlan,
  createLessonSession,
  createQuestion,
  createScenes,
  runInTransaction,
  seedAdaptationState,
  updateLessonSessionScriptingStatus,
} from "../db";
import { planLesson } from "./plan";
import { scriptConcept, scriptLessonSummary } from "./script";
import type { CreateSceneInput } from "../db/accessors/scenes";
import type {
  ConceptProgressRow,
  DocumentChunkRow,
  LearnerProfileRow,
  LessonPlanRow,
  LessonSessionRow,
  QuestionRow,
  ScriptingStatus,
  SceneRow,
} from "../db/types";
import type { Concept, LanguageCode, LearningDepth } from "../types";

/** Every concept's scripted beats reserve this many scene slots, so scene `order` can be precomputed per concept BEFORE dispatching parallel scripting — order must reflect lesson sequence, not promise-resolution order. */
const BEATS_PER_CONCEPT = 5;

/**
 * Concept scripting fans out one `scriptConcept()` per concept, and each of
 * those is itself two parallel model calls — so an unbounded fan-out on a
 * 12-concept plan (`deriveStructure`'s ceiling) would put 24 large requests
 * on the wire at once and turn a rate-limited burst into per-concept
 * failures. This is background work, so a small pool costs wall-clock the
 * caller never waits on.
 */
const MAX_CONCURRENT_CONCEPT_SCRIPTS = 3;

/**
 * Scene orders `0 .. conceptCount * BEATS_PER_CONCEPT` belong to the scripted
 * lesson (every concept's beats plus the closing summary), whether or not
 * background scripting has written them yet. Scenes minted later — adaptation
 * re-explanations and their follow-up checkpoints — must start above that
 * span, not above whatever happens to exist right now, or they collide with
 * a still-unscripted concept's slots and make `order` ambiguous.
 */
export function firstAdaptationSceneOrder(conceptCount: number): number {
  return conceptCount * BEATS_PER_CONCEPT + 1;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  });

  await Promise.all(runners);
  return results;
}

export interface PlanTaughtSessionInput {
  learnerProfile: LearnerProfileRow;
  topic: string;
  sourceDocumentId?: string;
  documentChunks?: DocumentChunkRow[];
  sectionHint?: string;
  totalMinutes: number;
  depth: LearningDepth;
  language: LanguageCode;
  priorProgress?: ConceptProgressRow[];
}

export interface PlannedSession {
  session: LessonSessionRow;
  plan: LessonPlanRow;
}

/**
 * The planning model call on its own — it writes nothing. A caller that
 * races this against a deadline (`runLlm` in app/api/teach/llmErrors.ts)
 * can abandon a slow one and answer the client without a half-created
 * lesson landing in the database minutes later, so persistence is the
 * caller's separate, synchronous step via `persistPlannedSession`.
 */
export async function planLessonConcepts(input: PlanTaughtSessionInput): Promise<Concept[]> {
  const concepts = await planLesson({
    topic: input.topic,
    learnerProfile: input.learnerProfile,
    language: input.language,
    totalMinutes: input.totalMinutes,
    depth: input.depth,
    sourceDocumentId: input.sourceDocumentId,
    sourceChunks: input.documentChunks,
    sectionHint: input.sectionHint,
    priorProgress: input.priorProgress,
  });

  if (concepts.length === 0) {
    throw new Error("planLesson produced no concepts.");
  }

  return concepts;
}

/** Persists an already-planned concept sequence as session/plan/concepts in one transaction. Scripting has not started yet — `session.scriptingStatus` is 'pending'. */
export function persistPlannedSession(input: PlanTaughtSessionInput, concepts: Concept[]): PlannedSession {
  return runInTransaction(() => {
    const session = createLessonSession({
      learnerProfileId: input.learnerProfile.id,
      topic: input.topic,
      sourceDocumentId: input.sourceDocumentId,
      language: input.language,
      totalMinutes: input.totalMinutes,
      depth: input.depth,
    });

    const plan = createLessonPlan({
      lessonSessionId: session.id,
      learnerProfileId: input.learnerProfile.id,
      topic: input.topic,
      sourceDocumentId: input.sourceDocumentId,
      language: input.language,
      totalMinutes: input.totalMinutes,
      depth: input.depth,
      concepts,
    });

    return { session, plan };
  });
}

/** The fast phase end to end: plan, then persist. HTTP callers use the two halves separately so a timed-out plan leaves nothing behind; non-HTTP callers (tests, scripts) can use this. */
export async function planTaughtLessonSession(input: PlanTaughtSessionInput): Promise<PlannedSession> {
  return persistPlannedSession(input, await planLessonConcepts(input));
}

export interface ScriptSessionResult {
  scenes: SceneRow[];
  questions: QuestionRow[];
  failedConceptTitles: string[];
  status: ScriptingStatus;
}

/**
 * The background phase: scripts every concept concurrently and persists
 * scenes/questions/adaptation-state as each one finishes. Intended to be
 * called without awaiting it in the HTTP response path (fire-and-forget) —
 * see app/api/teach/sessions/route.ts. Safe to await directly too (tests,
 * scripts, or a caller that genuinely wants to block on the whole lesson).
 */
export async function scriptTaughtLessonSession(
  session: LessonSessionRow,
  plan: LessonPlanRow,
  learnerProfile: LearnerProfileRow,
  language: LanguageCode,
): Promise<ScriptSessionResult> {
  updateLessonSessionScriptingStatus(session.id, "in_progress");

  const concepts = plan.concepts;

  const settled = await mapWithConcurrency(
    concepts,
    MAX_CONCURRENT_CONCEPT_SCRIPTS,
    async (concept, index) => {
      const scripted = await scriptConcept({ concept, learnerProfile, language });
      const explanationBeat = scripted.beats.find((b) => b.type === "explanation");

      seedAdaptationState({
        lessonSessionId: session.id,
        conceptId: concept.id,
        initialAnalogy: explanationBeat?.analogyLabel,
        initialDifficulty: scripted.question.difficulty,
      });

      const question = createQuestion({
        conceptId: concept.id,
        type: scripted.question.type,
        prompt: scripted.question.prompt,
        options: scripted.question.options,
        referenceAnswer: scripted.question.referenceAnswer,
        difficulty: scripted.question.difficulty,
      });

      const orderBase = index * BEATS_PER_CONCEPT;
      const sceneInputs: CreateSceneInput[] = scripted.beats.map((beat, beatIndex) => ({
        lessonPlanId: plan.id,
        conceptId: concept.id,
        type: beat.type,
        order: orderBase + beatIndex,
        narration: beat.narration,
        visual: beat.visual,
        questionId: beat.type === "checkpoint" ? question.id : undefined,
        estimatedSeconds: beat.estimatedSeconds,
      }));

      return { question, scenes: createScenes(sceneInputs) };
    },
  );

  const scenes: SceneRow[] = [];
  const questions: QuestionRow[] = [];
  const failedConceptTitles: string[] = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      scenes.push(...result.value.scenes);
      questions.push(result.value.question);
    } else {
      failedConceptTitles.push(concepts[index].title);
      console.error(`scriptTaughtLessonSession: failed to script concept "${concepts[index].title}":`, result.reason);
    }
  });

  if (questions.length > 0) {
    const successfulConcepts = concepts.filter((c) => !failedConceptTitles.includes(c.title));
    const summaryBeat = await scriptLessonSummary({
      topic: plan.topic,
      concepts: successfulConcepts,
      learnerProfile,
      language,
    }).catch((err) => {
      console.error("scriptTaughtLessonSession: failed to script the lesson summary:", err);
      return null;
    });

    if (summaryBeat) {
      scenes.push(
        ...createScenes([
          {
            lessonPlanId: plan.id,
            conceptId: successfulConcepts[successfulConcepts.length - 1].id,
            type: "summary",
            order: concepts.length * BEATS_PER_CONCEPT,
            narration: summaryBeat.narration,
            visual: summaryBeat.visual,
            estimatedSeconds: summaryBeat.estimatedSeconds,
          },
        ]),
      );
    }
  }

  const status: ScriptingStatus = failedConceptTitles.length === 0 ? "ready" : questions.length > 0 ? "partial" : "failed";
  const error = failedConceptTitles.length > 0 ? `Failed to script: ${failedConceptTitles.join(", ")}` : undefined;
  updateLessonSessionScriptingStatus(session.id, status, error);

  return { scenes, questions, failedConceptTitles, status };
}
