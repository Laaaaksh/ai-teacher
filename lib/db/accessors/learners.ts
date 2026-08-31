import { randomUUID } from "node:crypto";
import { getDb } from "../connection";
import type { LearnerProfileRow } from "../types";
import type { LearnerLevel, LearningDepth, LanguageCode } from "../../types";

interface Row {
  id: string;
  name: string;
  level: string;
  prior_knowledge: string;
  goal: string;
  style: string;
  language: string;
  minutes_available: number;
  depth: string;
  created_at: string;
  updated_at: string;
}

function fromRow(row: Row): LearnerProfileRow {
  return {
    id: row.id,
    name: row.name,
    level: row.level as LearnerLevel,
    priorKnowledge: row.prior_knowledge,
    goal: row.goal,
    style: row.style,
    language: row.language as LanguageCode,
    minutesAvailable: row.minutes_available,
    depth: row.depth as LearningDepth,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateLearnerProfileInput {
  name: string;
  level: LearnerLevel;
  priorKnowledge: string;
  goal: string;
  style: string;
  language: LanguageCode;
  minutesAvailable: number;
  depth: LearningDepth;
}

export function createLearnerProfile(input: CreateLearnerProfileInput): LearnerProfileRow {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO learner_profiles (id, name, level, prior_knowledge, goal, style, language, minutes_available, depth, created_at, updated_at)
     VALUES (@id, @name, @level, @priorKnowledge, @goal, @style, @language, @minutesAvailable, @depth, @now, @now)`,
  ).run({ id, now, ...input });

  return getLearnerProfile(id)!;
}

export function getLearnerProfile(id: string): LearnerProfileRow | undefined {
  const row = getDb().prepare("SELECT * FROM learner_profiles WHERE id = ?").get(id) as Row | undefined;
  return row ? fromRow(row) : undefined;
}

export function listLearnerProfiles(): LearnerProfileRow[] {
  const rows = getDb().prepare("SELECT * FROM learner_profiles ORDER BY created_at DESC").all() as Row[];
  return rows.map(fromRow);
}

export type UpdateLearnerProfileInput = Partial<CreateLearnerProfileInput>;

export function updateLearnerProfile(id: string, patch: UpdateLearnerProfileInput): LearnerProfileRow {
  const existing = getLearnerProfile(id);
  if (!existing) {
    throw new Error(`Learner profile ${id} does not exist.`);
  }

  const merged = { ...existing, ...patch };
  getDb()
    .prepare(
      `UPDATE learner_profiles
       SET name = @name, level = @level, prior_knowledge = @priorKnowledge, goal = @goal, style = @style,
           language = @language, minutes_available = @minutesAvailable, depth = @depth, updated_at = @updatedAt
       WHERE id = @id`,
    )
    .run({
      id,
      name: merged.name,
      level: merged.level,
      priorKnowledge: merged.priorKnowledge,
      goal: merged.goal,
      style: merged.style,
      language: merged.language,
      minutesAvailable: merged.minutesAvailable,
      depth: merged.depth,
      updatedAt: new Date().toISOString(),
    });

  return getLearnerProfile(id)!;
}
