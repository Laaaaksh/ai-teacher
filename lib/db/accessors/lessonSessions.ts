import { randomUUID } from "node:crypto";
import { getDb } from "../connection";
import type { LessonSessionRow, LessonSessionStatus, ScriptingStatus } from "../types";
import type { LanguageCode, LearningDepth } from "../../types";

interface Row {
  id: string;
  learner_profile_id: string;
  topic: string;
  source_document_id: string | null;
  language: string;
  total_minutes: number;
  depth: string;
  status: string;
  current_scene_order: number;
  started_at: string;
  completed_at: string | null;
  scripting_status: string;
  scripting_error: string | null;
}

function fromRow(row: Row): LessonSessionRow {
  return {
    id: row.id,
    learnerProfileId: row.learner_profile_id,
    topic: row.topic,
    sourceDocumentId: row.source_document_id,
    language: row.language as LanguageCode,
    totalMinutes: row.total_minutes,
    depth: row.depth as LearningDepth,
    status: row.status as LessonSessionStatus,
    currentSceneOrder: row.current_scene_order,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    scriptingStatus: row.scripting_status as ScriptingStatus,
    scriptingError: row.scripting_error,
  };
}

export interface CreateLessonSessionInput {
  learnerProfileId: string;
  topic: string;
  sourceDocumentId?: string;
  language: LanguageCode;
  totalMinutes: number;
  depth: LearningDepth;
}

export function createLessonSession(input: CreateLessonSessionInput): LessonSessionRow {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO lesson_sessions (id, learner_profile_id, topic, source_document_id, language, total_minutes, depth, status, current_scene_order, started_at)
     VALUES (@id, @learnerProfileId, @topic, @sourceDocumentId, @language, @totalMinutes, @depth, 'active', 0, @now)`,
  ).run({
    id,
    now,
    learnerProfileId: input.learnerProfileId,
    topic: input.topic,
    sourceDocumentId: input.sourceDocumentId ?? null,
    language: input.language,
    totalMinutes: input.totalMinutes,
    depth: input.depth,
  });

  return getLessonSession(id)!;
}

export function getLessonSession(id: string): LessonSessionRow | undefined {
  const row = getDb().prepare("SELECT * FROM lesson_sessions WHERE id = ?").get(id) as Row | undefined;
  return row ? fromRow(row) : undefined;
}

export function listLessonSessionsForLearner(learnerProfileId: string): LessonSessionRow[] {
  const rows = getDb()
    .prepare("SELECT * FROM lesson_sessions WHERE learner_profile_id = ? ORDER BY started_at DESC")
    .all(learnerProfileId) as Row[];
  return rows.map(fromRow);
}

export function advanceLessonSessionScene(id: string, currentSceneOrder: number): LessonSessionRow {
  getDb().prepare("UPDATE lesson_sessions SET current_scene_order = ? WHERE id = ?").run(currentSceneOrder, id);
  return getLessonSession(id)!;
}

/** Mid-lesson language switch ("ab hindi mein samjhao") — the session's language changes, scene position and history do not. */
export function updateLessonSessionLanguage(id: string, language: LanguageCode): LessonSessionRow {
  getDb().prepare("UPDATE lesson_sessions SET language = ? WHERE id = ?").run(language, id);
  return getLessonSession(id)!;
}

/** Moves the background scripting job's status forward — a caller polls GET /api/teach/sessions/:id for this rather than blocking POST on the whole lesson being scripted. */
export function updateLessonSessionScriptingStatus(id: string, status: ScriptingStatus, error?: string): LessonSessionRow {
  getDb()
    .prepare("UPDATE lesson_sessions SET scripting_status = ?, scripting_error = ? WHERE id = ?")
    .run(status, error ?? null, id);
  return getLessonSession(id)!;
}

export function completeLessonSession(id: string, status: Extract<LessonSessionStatus, "completed" | "abandoned"> = "completed"): LessonSessionRow {
  getDb()
    .prepare("UPDATE lesson_sessions SET status = ?, completed_at = ? WHERE id = ?")
    .run(status, new Date().toISOString(), id);
  return getLessonSession(id)!;
}
