import { randomUUID } from "node:crypto";
import { getDb } from "../connection";
import type { QuestionRow } from "../types";
import type { Question, QuestionType } from "../../types";

interface Row {
  id: string;
  concept_id: string;
  scene_id: string | null;
  type: string;
  prompt: string;
  options_json: string | null;
  reference_answer: string;
  difficulty: number;
  created_at: string;
}

function fromRow(row: Row): QuestionRow {
  return {
    id: row.id,
    conceptId: row.concept_id,
    sceneId: row.scene_id,
    type: row.type as QuestionType,
    prompt: row.prompt,
    options: row.options_json ? (JSON.parse(row.options_json) as string[]) : null,
    referenceAnswer: row.reference_answer,
    difficulty: row.difficulty as QuestionRow["difficulty"],
    createdAt: row.created_at,
  };
}

export type CreateQuestionInput = Omit<Question, "id">;

export function createQuestion(input: CreateQuestionInput): QuestionRow {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO questions (id, concept_id, scene_id, type, prompt, options_json, reference_answer, difficulty, created_at)
     VALUES (@id, @conceptId, @sceneId, @type, @prompt, @optionsJson, @referenceAnswer, @difficulty, @now)`,
  ).run({
    id,
    conceptId: input.conceptId,
    sceneId: input.sceneId ?? null,
    type: input.type,
    prompt: input.prompt,
    optionsJson: input.options ? JSON.stringify(input.options) : null,
    referenceAnswer: input.referenceAnswer,
    difficulty: input.difficulty,
    now,
  });

  return getQuestion(id)!;
}

export function getQuestion(id: string): QuestionRow | undefined {
  const row = getDb().prepare("SELECT * FROM questions WHERE id = ?").get(id) as Row | undefined;
  return row ? fromRow(row) : undefined;
}

export function getQuestionsForConcept(conceptId: string): QuestionRow[] {
  const rows = getDb().prepare("SELECT * FROM questions WHERE concept_id = ? ORDER BY created_at ASC").all(conceptId) as Row[];
  return rows.map(fromRow);
}
