import { randomUUID } from "node:crypto";
import { getDb } from "../connection";
import type { LessonPlanRow } from "../types";
import type { Concept, LanguageCode, LearningDepth } from "../../types";

interface Row {
  id: string;
  lesson_session_id: string;
  learner_profile_id: string;
  topic: string;
  source_document_id: string | null;
  language: string;
  total_minutes: number;
  depth: string;
  concepts_json: string;
  created_at: string;
}

function fromRow(row: Row): LessonPlanRow {
  return {
    id: row.id,
    lessonSessionId: row.lesson_session_id,
    learnerProfileId: row.learner_profile_id,
    topic: row.topic,
    sourceDocumentId: row.source_document_id,
    language: row.language as LanguageCode,
    totalMinutes: row.total_minutes,
    depth: row.depth as LearningDepth,
    concepts: JSON.parse(row.concepts_json) as Concept[],
    createdAt: row.created_at,
  };
}

export interface CreateLessonPlanInput {
  lessonSessionId: string;
  learnerProfileId: string;
  topic: string;
  sourceDocumentId?: string;
  language: LanguageCode;
  totalMinutes: number;
  depth: LearningDepth;
  concepts: Concept[];
}

/**
 * Persists a lesson plan and, in the same transaction, normalizes each
 * concept into its own `concepts` row so scenes, questions and
 * concept_progress can hold a stable foreign key to it.
 */
export function createLessonPlan(input: CreateLessonPlanInput): LessonPlanRow {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  const insertPlan = db.prepare(
    `INSERT INTO lesson_plans (id, lesson_session_id, learner_profile_id, topic, source_document_id, language, total_minutes, depth, concepts_json, created_at)
     VALUES (@id, @lessonSessionId, @learnerProfileId, @topic, @sourceDocumentId, @language, @totalMinutes, @depth, @conceptsJson, @now)`,
  );
  const insertConcept = db.prepare(
    `INSERT INTO concepts (id, lesson_plan_id, "order", title, summary, subject, difficulty, prerequisite_concept_ids_json, time_budget_seconds, visual_json, citations_json)
     VALUES (@id, @lessonPlanId, @order, @title, @summary, @subject, @difficulty, @prerequisiteConceptIdsJson, @timeBudgetSeconds, @visualJson, @citationsJson)`,
  );

  const run = db.transaction(() => {
    insertPlan.run({
      id,
      lessonSessionId: input.lessonSessionId,
      learnerProfileId: input.learnerProfileId,
      topic: input.topic,
      sourceDocumentId: input.sourceDocumentId ?? null,
      language: input.language,
      totalMinutes: input.totalMinutes,
      depth: input.depth,
      conceptsJson: JSON.stringify(input.concepts),
      now,
    });

    input.concepts.forEach((concept, order) => {
      insertConcept.run({
        id: concept.id,
        lessonPlanId: id,
        order,
        title: concept.title,
        summary: concept.summary,
        subject: concept.subject,
        difficulty: concept.difficulty,
        prerequisiteConceptIdsJson: JSON.stringify(concept.prerequisiteConceptIds),
        timeBudgetSeconds: concept.timeBudgetSeconds,
        visualJson: JSON.stringify(concept.visual),
        citationsJson: JSON.stringify(concept.citations),
      });
    });
  });
  run();

  return getLessonPlan(id)!;
}

export function getLessonPlan(id: string): LessonPlanRow | undefined {
  const row = getDb().prepare("SELECT * FROM lesson_plans WHERE id = ?").get(id) as Row | undefined;
  return row ? fromRow(row) : undefined;
}

export function getLessonPlanForSession(lessonSessionId: string): LessonPlanRow | undefined {
  const row = getDb()
    .prepare("SELECT * FROM lesson_plans WHERE lesson_session_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(lessonSessionId) as Row | undefined;
  return row ? fromRow(row) : undefined;
}
