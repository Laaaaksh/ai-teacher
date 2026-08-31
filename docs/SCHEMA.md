# Database schema

SQLite via `better-sqlite3`, file at `data/ai-teacher.sqlite` (created on first run;
override with `DB_PATH`, e.g. `:memory:` in tests). Migrations live in
`lib/db/migrations.ts` and run automatically on the first `getDb()` call
("a migration on boot"), tracked in `schema_migrations`. Never edit a shipped
migration — add a new one and bump `version`.

All accessors live under `lib/db/accessors/*.ts` and are re-exported from
`lib/db/index.ts`. Application code should never write raw SQL outside that
directory — every table below has a typed `create`/`get`/`list` (and `update`
where it makes sense) function that translates snake_case columns and JSON
columns into the camelCase row types in `lib/db/types.ts`, which themselves
reuse the domain contracts in `lib/types.ts` (`Concept`, `VisualSpec`,
`Question`, `Misconception`, etc.) wherever a column stores one as JSON.

## Tables

### `learner_profiles`
One row per learner. Drives every downstream personalization decision:
level, prior knowledge, goal, style, language, minutes available, depth.
See `lib/db/accessors/learners.ts`.

### `documents` / `document_chunks`
`documents` is one row per uploaded file (title, format, page count).
`document_chunks` holds the retrieval-sized pieces produced by
`lib/documents/chunk.ts`, each carrying `page` and/or `section` so an answer
grounded in the document can cite back to an exact location. `embedding` is
a nullable BLOB, intentionally unpopulated by this slice — the RAG slice
fills it with local MiniLM vectors (Sarvam has no embeddings endpoint; see
docs/ARCHITECTURE.md). See `lib/db/accessors/documents.ts`.

### `lesson_sessions`
One row per "sitting" with the AI Teacher: a learner, a topic, an optional
source document, a language/time/depth, and a status
(`active`/`completed`/`abandoned`). `current_scene_order` is a resume
pointer for the lesson player. See `lib/db/accessors/lessonSessions.ts`.

### `lesson_plans` / `concepts`
`lesson_plans` stores the full ordered `Concept[]` for a session as
`concepts_json` (so the planner slice can round-trip a `LessonPlan` exactly
as typed in `lib/types.ts`) **and** normalizes each concept into its own
`concepts` row in the same transaction. The normalized row is what `scenes`,
`questions` and `concept_progress` actually reference — `concepts_json`
alone can't be a foreign key target. See `lib/db/accessors/lessonPlans.ts`.

### `scenes`
One row per beat of the taught lesson (introduction/explanation/example/
checkpoint/transition/summary), in order, each pointing at the concept it
belongs to and optionally a `visual_json` (a `VisualSpec`) and a
`question_id` when the scene is a checkpoint. This is the unit the video
generation slice storyboards and the lesson player steps through. See
`lib/db/accessors/scenes.ts`.

### `questions`
One row per question asked (mcq/short-answer/problem-solving/application/
explain-in-own-words), with a `reference_answer` used only for evaluation,
never shown to the learner up front. See `lib/db/accessors/questions.ts`.

### `student_answers`
One row per answer a learner gives, with the evaluator's verdict
(correct/partial/incorrect), an optional `misconception_json`
(`Misconception` — required context for adaptation, not just "wrong"),
feedback text, and a `difficulty_adjustment` (-1/0/+1) the lesson player
uses to pick the next question's difficulty. See
`lib/db/accessors/studentAnswers.ts`.

### `assessment_reports`
One row per end-of-lesson report: score, concepts understood, weak areas,
misconceptions held, a recommended revision and a suggested next topic —
the fields the spec's example report (`Score: 80%`, `Strong Areas: ...`)
maps onto directly. See `lib/db/accessors/assessmentReports.ts`.

### `concept_progress`
Per-learner, per-concept mastery, keyed by `(learner_profile_id,
concept_id)` so re-teaching the same concept in a later session updates the
existing row (`upsertConceptProgress`) instead of duplicating it. This is
what "track learning progress" and future-session personalization read
from. See `lib/db/accessors/conceptProgress.ts`.

### `learning_paths`
For broad topics: an ordered list of steps (`steps_json`, a
`LearningPathStep[]`) plus `current_step_index`, so the AI Teacher can say
"you are on step 3 of 8" and unlock the next step as the learner completes
one. See `lib/db/accessors/learningPaths.ts`.

## Foreign keys and cascades

`PRAGMA foreign_keys = ON` is set on every connection. Deleting a
`learner_profile` cascades to their sessions, plans, progress and learning
paths; deleting a `document` cascades to its chunks and sets
`source_document_id` to `NULL` on any session/plan that referenced it
(the lesson itself is not deleted just because its source material was).

One deliberate exception: `scenes.question_id` has no `REFERENCES` clause,
because `questions.scene_id` already references `scenes(id)` and a reciprocal
FK would be circular — slices writing a checkpoint scene must validate the
question id themselves, since SQLite will accept a stale one silently.

## What later slices are expected to add

- RAG slice: populate `document_chunks.embedding`; no new table needed
  unless it wants a separate vector index.
- Lesson planner slice: `createLessonSession` + `createLessonPlan` +
  `createScenes` + `createQuestion`.
- Lesson player / adaptation slice: `recordStudentAnswer`,
  `upsertConceptProgress`, `advanceLessonSessionScene`.
- Assessment slice: `createAssessmentReport`, `completeLessonSession`.
- Learning-path slice: `createLearningPath`, `updateLearningPathProgress`.

None of this requires a schema change for the features described in
docs/ARCHITECTURE.md; if a later slice needs a new column, add a migration
rather than editing an existing table's `CREATE TABLE` in place.
