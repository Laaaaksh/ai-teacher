/**
 * Schema migrations, applied in order on boot. Each entry is idempotent SQL
 * run inside a transaction; see docs/SCHEMA.md for the reasoning behind
 * each table. Never edit a migration once it has shipped — add a new one.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "initial schema",
    sql: `
      CREATE TABLE learner_profiles (
        id                 TEXT PRIMARY KEY,
        name               TEXT NOT NULL,
        level              TEXT NOT NULL CHECK (level IN ('beginner','intermediate','advanced')),
        prior_knowledge    TEXT NOT NULL DEFAULT '',
        goal               TEXT NOT NULL DEFAULT '',
        style              TEXT NOT NULL DEFAULT '',
        language           TEXT NOT NULL,
        minutes_available  INTEGER NOT NULL,
        depth              TEXT NOT NULL CHECK (depth IN ('overview','standard','deep')),
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );

      CREATE TABLE documents (
        id           TEXT PRIMARY KEY,
        title        TEXT NOT NULL,
        format       TEXT NOT NULL CHECK (format IN ('pdf','docx','pptx','txt','md')),
        page_count   INTEGER,
        language     TEXT,
        uploaded_at  TEXT NOT NULL
      );

      -- Chunks sized for retrieval. embedding is populated by the RAG slice
      -- (local MiniLM vectors serialized as a Float32 BLOB); NULL until then.
      CREATE TABLE document_chunks (
        id           TEXT PRIMARY KEY,
        document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        "order"      INTEGER NOT NULL,
        text         TEXT NOT NULL,
        page         INTEGER,
        section      TEXT,
        embedding    BLOB,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX idx_document_chunks_document ON document_chunks(document_id);

      CREATE TABLE lesson_sessions (
        id                  TEXT PRIMARY KEY,
        learner_profile_id  TEXT NOT NULL REFERENCES learner_profiles(id) ON DELETE CASCADE,
        topic               TEXT NOT NULL,
        source_document_id  TEXT REFERENCES documents(id) ON DELETE SET NULL,
        language            TEXT NOT NULL,
        total_minutes       INTEGER NOT NULL,
        depth               TEXT NOT NULL CHECK (depth IN ('overview','standard','deep')),
        status              TEXT NOT NULL CHECK (status IN ('active','completed','abandoned')) DEFAULT 'active',
        current_scene_order INTEGER NOT NULL DEFAULT 0,
        started_at          TEXT NOT NULL,
        completed_at        TEXT
      );
      CREATE INDEX idx_lesson_sessions_learner ON lesson_sessions(learner_profile_id);

      -- One row per LessonPlan. concepts_json holds the ordered Concept[]
      -- (lib/types.ts); concepts below normalizes each concept into its
      -- own row so progress/mastery can join on a stable concept id.
      CREATE TABLE lesson_plans (
        id                  TEXT PRIMARY KEY,
        lesson_session_id   TEXT NOT NULL REFERENCES lesson_sessions(id) ON DELETE CASCADE,
        learner_profile_id  TEXT NOT NULL REFERENCES learner_profiles(id) ON DELETE CASCADE,
        topic               TEXT NOT NULL,
        source_document_id  TEXT REFERENCES documents(id) ON DELETE SET NULL,
        language            TEXT NOT NULL,
        total_minutes       INTEGER NOT NULL,
        depth               TEXT NOT NULL,
        concepts_json       TEXT NOT NULL,
        created_at          TEXT NOT NULL
      );
      CREATE INDEX idx_lesson_plans_session ON lesson_plans(lesson_session_id);

      CREATE TABLE concepts (
        id                          TEXT PRIMARY KEY,
        lesson_plan_id              TEXT NOT NULL REFERENCES lesson_plans(id) ON DELETE CASCADE,
        "order"                     INTEGER NOT NULL,
        title                       TEXT NOT NULL,
        summary                     TEXT NOT NULL,
        subject                     TEXT NOT NULL,
        difficulty                  INTEGER NOT NULL,
        prerequisite_concept_ids_json TEXT NOT NULL DEFAULT '[]',
        time_budget_seconds         INTEGER NOT NULL,
        visual_json                 TEXT NOT NULL,
        citations_json              TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX idx_concepts_lesson_plan ON concepts(lesson_plan_id);

      CREATE TABLE scenes (
        id            TEXT PRIMARY KEY,
        lesson_plan_id TEXT NOT NULL REFERENCES lesson_plans(id) ON DELETE CASCADE,
        concept_id    TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
        type          TEXT NOT NULL CHECK (type IN ('introduction','explanation','example','checkpoint','transition','summary')),
        "order"       INTEGER NOT NULL,
        narration     TEXT NOT NULL,
        visual_json   TEXT,
        question_id   TEXT,
        estimated_seconds INTEGER NOT NULL
      );
      CREATE INDEX idx_scenes_lesson_plan ON scenes(lesson_plan_id);
      CREATE INDEX idx_scenes_concept ON scenes(concept_id);

      CREATE TABLE questions (
        id               TEXT PRIMARY KEY,
        concept_id       TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
        scene_id         TEXT REFERENCES scenes(id) ON DELETE SET NULL,
        type             TEXT NOT NULL CHECK (type IN ('mcq','short-answer','problem-solving','application','explain-in-own-words')),
        prompt           TEXT NOT NULL,
        options_json     TEXT,
        reference_answer TEXT NOT NULL,
        difficulty       INTEGER NOT NULL,
        created_at       TEXT NOT NULL
      );
      CREATE INDEX idx_questions_concept ON questions(concept_id);

      CREATE TABLE student_answers (
        id                    TEXT PRIMARY KEY,
        question_id           TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        lesson_session_id     TEXT NOT NULL REFERENCES lesson_sessions(id) ON DELETE CASCADE,
        student_answer        TEXT NOT NULL,
        verdict               TEXT NOT NULL CHECK (verdict IN ('correct','partial','incorrect')),
        misconception_json    TEXT,
        feedback              TEXT NOT NULL,
        difficulty_adjustment INTEGER NOT NULL DEFAULT 0,
        evaluated_at          TEXT NOT NULL
      );
      CREATE INDEX idx_student_answers_session ON student_answers(lesson_session_id);
      CREATE INDEX idx_student_answers_question ON student_answers(question_id);

      CREATE TABLE assessment_reports (
        id                        TEXT PRIMARY KEY,
        lesson_session_id         TEXT NOT NULL REFERENCES lesson_sessions(id) ON DELETE CASCADE,
        topic                     TEXT NOT NULL,
        score                     REAL NOT NULL,
        concepts_understood_json  TEXT NOT NULL DEFAULT '[]',
        weak_areas_json           TEXT NOT NULL DEFAULT '[]',
        misconceptions_held_json  TEXT NOT NULL DEFAULT '[]',
        recommended_revision      TEXT NOT NULL DEFAULT '',
        suggested_next_topic      TEXT NOT NULL DEFAULT '',
        generated_at              TEXT NOT NULL
      );
      CREATE INDEX idx_assessment_reports_session ON assessment_reports(lesson_session_id);

      -- Per-concept mastery for a learner, updated after each evaluation.
      -- Keyed by (learner, concept) so re-teaching the same concept in a
      -- later session updates the same row rather than duplicating it.
      CREATE TABLE concept_progress (
        learner_profile_id TEXT NOT NULL REFERENCES learner_profiles(id) ON DELETE CASCADE,
        concept_id         TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
        concept_title      TEXT NOT NULL,
        mastery            TEXT NOT NULL CHECK (mastery IN ('not-started','struggling','developing','proficient','mastered')),
        mastery_score      REAL NOT NULL DEFAULT 0,
        last_assessed_at   TEXT NOT NULL,
        PRIMARY KEY (learner_profile_id, concept_id)
      );
      CREATE INDEX idx_concept_progress_learner ON concept_progress(learner_profile_id);

      CREATE TABLE learning_paths (
        id                  TEXT PRIMARY KEY,
        learner_profile_id  TEXT NOT NULL REFERENCES learner_profiles(id) ON DELETE CASCADE,
        topic               TEXT NOT NULL,
        steps_json          TEXT NOT NULL,
        current_step_index  INTEGER NOT NULL DEFAULT 0,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );
      CREATE INDEX idx_learning_paths_learner ON learning_paths(learner_profile_id);
    `,
  },
  {
    version: 2,
    name: "video jobs",
    sql: `
      -- One row per teaching-video render, tracking a real in-process
      -- render pipeline (narration -> per-scene frame capture -> ffmpeg
      -- mux -> concat). progress_percent/stage_detail are updated live so a
      -- client can poll honest progress rather than a fake spinner.
      CREATE TABLE video_jobs (
        id                TEXT PRIMARY KEY,
        lesson_plan_id    TEXT NOT NULL REFERENCES lesson_plans(id) ON DELETE CASCADE,
        persona_id        TEXT NOT NULL,
        status            TEXT NOT NULL CHECK (status IN ('queued','narrating','rendering','muxing','completed','failed')),
        progress_percent  REAL NOT NULL DEFAULT 0,
        stage_detail      TEXT,
        output_path       TEXT,
        error_message     TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );
      CREATE INDEX idx_video_jobs_lesson_plan ON video_jobs(lesson_plan_id);
    `,
  },
];
