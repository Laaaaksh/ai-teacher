import { randomUUID } from "node:crypto";
import { getDb } from "../connection";
import type { LearningPathRow } from "../types";
import type { LearningPathStep } from "../../types";

interface Row {
  id: string;
  learner_profile_id: string;
  topic: string;
  steps_json: string;
  current_step_index: number;
  created_at: string;
  updated_at: string;
}

function fromRow(row: Row): LearningPathRow {
  return {
    id: row.id,
    learnerProfileId: row.learner_profile_id,
    topic: row.topic,
    steps: JSON.parse(row.steps_json) as LearningPathStep[],
    currentStepIndex: row.current_step_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateLearningPathInput {
  learnerProfileId: string;
  topic: string;
  steps: LearningPathStep[];
}

export function createLearningPath(input: CreateLearningPathInput): LearningPathRow {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO learning_paths (id, learner_profile_id, topic, steps_json, current_step_index, created_at, updated_at)
     VALUES (@id, @learnerProfileId, @topic, @stepsJson, 0, @now, @now)`,
  ).run({ id, learnerProfileId: input.learnerProfileId, topic: input.topic, stepsJson: JSON.stringify(input.steps), now });

  return getLearningPath(id)!;
}

export function getLearningPath(id: string): LearningPathRow | undefined {
  const row = getDb().prepare("SELECT * FROM learning_paths WHERE id = ?").get(id) as Row | undefined;
  return row ? fromRow(row) : undefined;
}

export function getLearningPathsForLearner(learnerProfileId: string): LearningPathRow[] {
  const rows = getDb()
    .prepare("SELECT * FROM learning_paths WHERE learner_profile_id = ? ORDER BY updated_at DESC")
    .all(learnerProfileId) as Row[];
  return rows.map(fromRow);
}

export function updateLearningPathProgress(id: string, steps: LearningPathStep[], currentStepIndex: number): LearningPathRow {
  getDb()
    .prepare("UPDATE learning_paths SET steps_json = ?, current_step_index = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(steps), currentStepIndex, new Date().toISOString(), id);
  return getLearningPath(id)!;
}
