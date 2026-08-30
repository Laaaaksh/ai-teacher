import { getDb } from "../connection";

/**
 * Tracks, per (lesson session, concept), which analogies adapt.ts has
 * already spent re-explaining this concept — the state that makes "use a
 * different analogy" enforceable rather than just prompted for.
 */
export interface ConceptAdaptationStateRow {
  lessonSessionId: string;
  conceptId: string;
  usedAnalogies: string[];
  attemptCount: number;
  currentDifficulty: number;
  updatedAt: string;
}

interface Row {
  lesson_session_id: string;
  concept_id: string;
  used_analogies_json: string;
  attempt_count: number;
  current_difficulty: number;
  updated_at: string;
}

function fromRow(row: Row): ConceptAdaptationStateRow {
  return {
    lessonSessionId: row.lesson_session_id,
    conceptId: row.concept_id,
    usedAnalogies: JSON.parse(row.used_analogies_json) as string[],
    attemptCount: row.attempt_count,
    currentDifficulty: row.current_difficulty,
    updatedAt: row.updated_at,
  };
}

export function getAdaptationState(lessonSessionId: string, conceptId: string): ConceptAdaptationStateRow | undefined {
  const row = getDb()
    .prepare("SELECT * FROM concept_adaptation_state WHERE lesson_session_id = ? AND concept_id = ?")
    .get(lessonSessionId, conceptId) as Row | undefined;
  return row ? fromRow(row) : undefined;
}

/**
 * Seeds the row at lesson-scripting time with the analogy the original
 * explanation scene used, so the first adaptation already knows to avoid
 * it — without this, "different analogy" could only be enforced starting
 * from the *second* miss. INSERT OR IGNORE: a no-op if adaptation already
 * happened on this concept before the seed call runs.
 */
export function seedAdaptationState(input: {
  lessonSessionId: string;
  conceptId: string;
  initialAnalogy?: string;
  initialDifficulty: number;
}): ConceptAdaptationStateRow {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT OR IGNORE INTO concept_adaptation_state (lesson_session_id, concept_id, used_analogies_json, attempt_count, current_difficulty, updated_at)
     VALUES (@lessonSessionId, @conceptId, @usedAnalogiesJson, 0, @currentDifficulty, @now)`,
  ).run({
    lessonSessionId: input.lessonSessionId,
    conceptId: input.conceptId,
    usedAnalogiesJson: JSON.stringify(input.initialAnalogy ? [input.initialAnalogy] : []),
    currentDifficulty: input.initialDifficulty,
    now,
  });

  return getAdaptationState(input.lessonSessionId, input.conceptId)!;
}

/**
 * Records that `analogyUsed` has now been spent on this concept and moves
 * `currentDifficulty` to `nextDifficulty`. Insert-or-update keyed by
 * (lesson_session_id, concept_id), so repeated misses accumulate onto the
 * same row instead of losing history. `countsAsAttempt` is false for a
 * correct-answer difficulty bump, which shouldn't count toward the
 * prerequisite-drop threshold in lib/teach/adapt.ts.
 */
export function recordAdaptationAttempt(input: {
  lessonSessionId: string;
  conceptId: string;
  analogyUsed?: string;
  nextDifficulty: number;
  countsAsAttempt?: boolean;
}): ConceptAdaptationStateRow {
  const db = getDb();
  const existing = getAdaptationState(input.lessonSessionId, input.conceptId);
  const usedAnalogies = existing ? [...existing.usedAnalogies] : [];
  if (input.analogyUsed && !usedAnalogies.includes(input.analogyUsed)) {
    usedAnalogies.push(input.analogyUsed);
  }
  const attemptCount = (existing?.attemptCount ?? 0) + (input.countsAsAttempt === false ? 0 : 1);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO concept_adaptation_state (lesson_session_id, concept_id, used_analogies_json, attempt_count, current_difficulty, updated_at)
     VALUES (@lessonSessionId, @conceptId, @usedAnalogiesJson, @attemptCount, @currentDifficulty, @now)
     ON CONFLICT (lesson_session_id, concept_id)
     DO UPDATE SET used_analogies_json = excluded.used_analogies_json, attempt_count = excluded.attempt_count,
                    current_difficulty = excluded.current_difficulty, updated_at = excluded.updated_at`,
  ).run({
    lessonSessionId: input.lessonSessionId,
    conceptId: input.conceptId,
    usedAnalogiesJson: JSON.stringify(usedAnalogies),
    attemptCount,
    currentDifficulty: input.nextDifficulty,
    now,
  });

  return getAdaptationState(input.lessonSessionId, input.conceptId)!;
}

export function getAdaptationStatesForSession(lessonSessionId: string): ConceptAdaptationStateRow[] {
  const rows = getDb()
    .prepare("SELECT * FROM concept_adaptation_state WHERE lesson_session_id = ?")
    .all(lessonSessionId) as Row[];
  return rows.map(fromRow);
}
