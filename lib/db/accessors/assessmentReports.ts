import { randomUUID } from "node:crypto";
import { getDb } from "../connection";
import type { AssessmentReportRow } from "../types";
import type { Misconception } from "../../types";

interface Row {
  id: string;
  lesson_session_id: string;
  topic: string;
  score: number;
  concepts_understood_json: string;
  weak_areas_json: string;
  misconceptions_held_json: string;
  recommended_revision: string;
  suggested_next_topic: string;
  generated_at: string;
}

function fromRow(row: Row): AssessmentReportRow {
  return {
    id: row.id,
    lessonSessionId: row.lesson_session_id,
    topic: row.topic,
    score: row.score,
    conceptsUnderstood: JSON.parse(row.concepts_understood_json) as string[],
    weakAreas: JSON.parse(row.weak_areas_json) as string[],
    misconceptionsHeld: JSON.parse(row.misconceptions_held_json) as Misconception[],
    recommendedRevision: row.recommended_revision,
    suggestedNextTopic: row.suggested_next_topic,
    generatedAt: row.generated_at,
  };
}

export interface CreateAssessmentReportInput {
  lessonSessionId: string;
  topic: string;
  score: number;
  conceptsUnderstood: string[];
  weakAreas: string[];
  misconceptionsHeld: Misconception[];
  recommendedRevision: string;
  suggestedNextTopic: string;
}

export function createAssessmentReport(input: CreateAssessmentReportInput): AssessmentReportRow {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO assessment_reports (id, lesson_session_id, topic, score, concepts_understood_json, weak_areas_json, misconceptions_held_json, recommended_revision, suggested_next_topic, generated_at)
     VALUES (@id, @lessonSessionId, @topic, @score, @conceptsUnderstoodJson, @weakAreasJson, @misconceptionsHeldJson, @recommendedRevision, @suggestedNextTopic, @now)`,
  ).run({
    id,
    lessonSessionId: input.lessonSessionId,
    topic: input.topic,
    score: input.score,
    conceptsUnderstoodJson: JSON.stringify(input.conceptsUnderstood),
    weakAreasJson: JSON.stringify(input.weakAreas),
    misconceptionsHeldJson: JSON.stringify(input.misconceptionsHeld),
    recommendedRevision: input.recommendedRevision,
    suggestedNextTopic: input.suggestedNextTopic,
    now,
  });

  return getAssessmentReport(id)!;
}

export function getAssessmentReport(id: string): AssessmentReportRow | undefined {
  const row = getDb().prepare("SELECT * FROM assessment_reports WHERE id = ?").get(id) as Row | undefined;
  return row ? fromRow(row) : undefined;
}

export function getAssessmentReportForSession(lessonSessionId: string): AssessmentReportRow | undefined {
  const row = getDb()
    .prepare("SELECT * FROM assessment_reports WHERE lesson_session_id = ? ORDER BY generated_at DESC LIMIT 1")
    .get(lessonSessionId) as Row | undefined;
  return row ? fromRow(row) : undefined;
}
