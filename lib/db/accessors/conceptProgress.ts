import { getDb } from "../connection";
import type { ConceptProgressRow, MasteryLevel } from "../types";

interface Row {
  learner_profile_id: string;
  concept_id: string;
  concept_title: string;
  mastery: string;
  mastery_score: number;
  last_assessed_at: string;
}

function fromRow(row: Row): ConceptProgressRow {
  return {
    learnerProfileId: row.learner_profile_id,
    conceptId: row.concept_id,
    conceptTitle: row.concept_title,
    mastery: row.mastery as MasteryLevel,
    masteryScore: row.mastery_score,
    lastAssessedAt: row.last_assessed_at,
  };
}

export interface UpsertConceptProgressInput {
  learnerProfileId: string;
  conceptId: string;
  conceptTitle: string;
  mastery: MasteryLevel;
  masteryScore: number;
}

/** Insert-or-update a learner's mastery for one concept, keyed by (learner, concept). */
export function upsertConceptProgress(input: UpsertConceptProgressInput): ConceptProgressRow {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO concept_progress (learner_profile_id, concept_id, concept_title, mastery, mastery_score, last_assessed_at)
     VALUES (@learnerProfileId, @conceptId, @conceptTitle, @mastery, @masteryScore, @now)
     ON CONFLICT (learner_profile_id, concept_id)
     DO UPDATE SET mastery = excluded.mastery, mastery_score = excluded.mastery_score, last_assessed_at = excluded.last_assessed_at`,
  ).run({ ...input, now });

  const row = db
    .prepare("SELECT * FROM concept_progress WHERE learner_profile_id = ? AND concept_id = ?")
    .get(input.learnerProfileId, input.conceptId) as Row;
  return fromRow(row);
}

export function getConceptProgressForLearner(learnerProfileId: string): ConceptProgressRow[] {
  const rows = getDb()
    .prepare("SELECT * FROM concept_progress WHERE learner_profile_id = ? ORDER BY last_assessed_at DESC")
    .all(learnerProfileId) as Row[];
  return rows.map(fromRow);
}
