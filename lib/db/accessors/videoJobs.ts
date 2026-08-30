import { randomUUID } from "node:crypto";
import { getDb } from "../connection";
import type { VideoJobRow, VideoJobStatus } from "../types";

interface Row {
  id: string;
  lesson_plan_id: string;
  persona_id: string;
  status: string;
  progress_percent: number;
  stage_detail: string | null;
  output_path: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function fromRow(row: Row): VideoJobRow {
  return {
    id: row.id,
    lessonPlanId: row.lesson_plan_id,
    personaId: row.persona_id,
    status: row.status as VideoJobStatus,
    progressPercent: row.progress_percent,
    stageDetail: row.stage_detail,
    outputPath: row.output_path,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createVideoJob(input: { lessonPlanId: string; personaId: string }): VideoJobRow {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO video_jobs (id, lesson_plan_id, persona_id, status, progress_percent, stage_detail, output_path, error_message, created_at, updated_at)
     VALUES (@id, @lessonPlanId, @personaId, 'queued', 0, NULL, NULL, NULL, @now, @now)`,
  ).run({ id, lessonPlanId: input.lessonPlanId, personaId: input.personaId, now });

  return getVideoJob(id)!;
}

export function getVideoJob(id: string): VideoJobRow | undefined {
  const row = getDb().prepare("SELECT * FROM video_jobs WHERE id = ?").get(id) as Row | undefined;
  return row ? fromRow(row) : undefined;
}

export function updateVideoJobProgress(id: string, status: VideoJobStatus, progressPercent: number, stageDetail?: string): VideoJobRow {
  getDb()
    .prepare("UPDATE video_jobs SET status = ?, progress_percent = ?, stage_detail = ?, updated_at = ? WHERE id = ?")
    .run(status, progressPercent, stageDetail ?? null, new Date().toISOString(), id);
  return getVideoJob(id)!;
}

export function completeVideoJob(id: string, outputPath: string): VideoJobRow {
  getDb()
    .prepare("UPDATE video_jobs SET status = 'completed', progress_percent = 100, output_path = ?, updated_at = ? WHERE id = ?")
    .run(outputPath, new Date().toISOString(), id);
  return getVideoJob(id)!;
}

export function failVideoJob(id: string, errorMessage: string): VideoJobRow {
  getDb()
    .prepare("UPDATE video_jobs SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?")
    .run(errorMessage, new Date().toISOString(), id);
  return getVideoJob(id)!;
}
