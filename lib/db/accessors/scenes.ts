import { randomUUID } from "node:crypto";
import { getDb } from "../connection";
import type { SceneRow } from "../types";
import type { Scene, SceneType, VisualSpec } from "../../types";

interface Row {
  id: string;
  lesson_plan_id: string;
  concept_id: string;
  type: string;
  order: number;
  narration: string;
  visual_json: string | null;
  question_id: string | null;
  estimated_seconds: number;
}

function fromRow(row: Row): SceneRow {
  return {
    id: row.id,
    lessonPlanId: row.lesson_plan_id,
    conceptId: row.concept_id,
    type: row.type as SceneType,
    order: row.order,
    narration: row.narration,
    visual: row.visual_json ? (JSON.parse(row.visual_json) as VisualSpec) : null,
    questionId: row.question_id,
    estimatedSeconds: row.estimated_seconds,
  };
}

export type CreateSceneInput = Omit<Scene, "id">;

export function createScene(input: CreateSceneInput): SceneRow {
  const db = getDb();
  const id = randomUUID();

  db.prepare(
    `INSERT INTO scenes (id, lesson_plan_id, concept_id, type, "order", narration, visual_json, question_id, estimated_seconds)
     VALUES (@id, @lessonPlanId, @conceptId, @type, @order, @narration, @visualJson, @questionId, @estimatedSeconds)`,
  ).run({
    id,
    lessonPlanId: input.lessonPlanId,
    conceptId: input.conceptId,
    type: input.type,
    order: input.order,
    narration: input.narration,
    visualJson: input.visual ? JSON.stringify(input.visual) : null,
    questionId: input.questionId ?? null,
    estimatedSeconds: input.estimatedSeconds,
  });

  return getScene(id)!;
}

export function createScenes(inputs: CreateSceneInput[]): SceneRow[] {
  const db = getDb();
  const run = db.transaction(() => inputs.map(createScene));
  return run();
}

export function getScene(id: string): SceneRow | undefined {
  const row = getDb().prepare("SELECT * FROM scenes WHERE id = ?").get(id) as Row | undefined;
  return row ? fromRow(row) : undefined;
}

export function getScenesForLessonPlan(lessonPlanId: string): SceneRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM scenes WHERE lesson_plan_id = ? ORDER BY "order" ASC`)
    .all(lessonPlanId) as Row[];
  return rows.map(fromRow);
}
