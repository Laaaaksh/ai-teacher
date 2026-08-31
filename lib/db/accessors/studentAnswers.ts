import { randomUUID } from "node:crypto";
import { getDb } from "../connection";
import type { AnswerVerdict, StudentAnswerRow } from "../types";
import type { Misconception } from "../../types";

interface Row {
  id: string;
  question_id: string;
  lesson_session_id: string;
  student_answer: string;
  verdict: string;
  misconception_json: string | null;
  feedback: string;
  difficulty_adjustment: number;
  evaluated_at: string;
}

function fromRow(row: Row): StudentAnswerRow {
  return {
    id: row.id,
    questionId: row.question_id,
    lessonSessionId: row.lesson_session_id,
    studentAnswer: row.student_answer,
    verdict: row.verdict as AnswerVerdict,
    misconception: row.misconception_json ? (JSON.parse(row.misconception_json) as Misconception) : null,
    feedback: row.feedback,
    difficultyAdjustment: row.difficulty_adjustment as StudentAnswerRow["difficultyAdjustment"],
    evaluatedAt: row.evaluated_at,
  };
}

export interface RecordStudentAnswerInput {
  questionId: string;
  lessonSessionId: string;
  studentAnswer: string;
  verdict: AnswerVerdict;
  misconception?: Misconception;
  feedback: string;
  difficultyAdjustment: -1 | 0 | 1;
}

export function recordStudentAnswer(input: RecordStudentAnswerInput): StudentAnswerRow {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO student_answers (id, question_id, lesson_session_id, student_answer, verdict, misconception_json, feedback, difficulty_adjustment, evaluated_at)
     VALUES (@id, @questionId, @lessonSessionId, @studentAnswer, @verdict, @misconceptionJson, @feedback, @difficultyAdjustment, @now)`,
  ).run({
    id,
    questionId: input.questionId,
    lessonSessionId: input.lessonSessionId,
    studentAnswer: input.studentAnswer,
    verdict: input.verdict,
    misconceptionJson: input.misconception ? JSON.stringify(input.misconception) : null,
    feedback: input.feedback,
    difficultyAdjustment: input.difficultyAdjustment,
    now,
  });

  return getStudentAnswer(id)!;
}

export function getStudentAnswer(id: string): StudentAnswerRow | undefined {
  const row = getDb().prepare("SELECT * FROM student_answers WHERE id = ?").get(id) as Row | undefined;
  return row ? fromRow(row) : undefined;
}

export function getStudentAnswersForSession(lessonSessionId: string): StudentAnswerRow[] {
  const rows = getDb()
    .prepare("SELECT * FROM student_answers WHERE lesson_session_id = ? ORDER BY evaluated_at ASC")
    .all(lessonSessionId) as Row[];
  return rows.map(fromRow);
}
