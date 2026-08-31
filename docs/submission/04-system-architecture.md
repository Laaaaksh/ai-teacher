# System architecture

One Next.js 15 (App Router, TypeScript strict) application. No separate
backend service, no external database, no message queue — SQLite on disk,
local embeddings, headless Chromium and `ffmpeg` as subprocesses. This keeps
the whole system runnable from `git clone` plus one environment variable (see
[14 — Setup instructions](14-setup-instructions.md)), which matters for a
judge who has to actually run it.

The full narrative design decisions and every "why" behind the choices below
live in `docs/ARCHITECTURE.md`, `docs/SCHEMA.md` and `docs/VIDEO.md` at the
repository root — this document is the jury-facing map; those are the
engineering reference.

## Component map

```mermaid
flowchart TB
    subgraph Client["Browser (app/)"]
        Entry["Entry page\nupload / topic + instruction"]
        PlanReview["Plan review\nconcepts, minutes, visual + why"]
        Player["Lesson player\nvideo segment + checkpoint"]
        Assess["Assessment + Report"]
        Progress["Progress dashboard"]
    end

    subgraph API["app/api/ (Next.js route handlers)"]
        DocAPI["/api/documents/*"]
        RagAPI["/api/rag/ask"]
        TeachAPI["/api/teach/*"]
        VideoAPI["/api/video/*"]
        SpeechAPI["/api/speech"]
    end

    subgraph Engine["lib/ (server-side)"]
        Documents["lib/documents/\nparse PDF/DOCX/PPTX/TXT/MD"]
        Rag["lib/rag/\nchunk, embed, BM25, hybrid retrieve, ground"]
        Teach["lib/teach/\nUnderstand-Plan-Explain-Question-\nEvaluate-Adapt-Continue"]
        Video["lib/video/\nnarrate, visuals, avatar, compose, render"]
        Sarvam["lib/sarvam/\nchat, TTS, translate, STT client"]
        Db["lib/db/\nSQLite, one accessor per table"]
    end

    subgraph External["External"]
        SarvamAPI["Sarvam AI\nchat / TTS / translate / STT"]
        Local["Local, key-free\nMiniLM embeddings, ffmpeg, Chromium"]
    end

    Entry --> DocAPI & TeachAPI
    PlanReview --> TeachAPI
    Player --> TeachAPI & VideoAPI & SpeechAPI
    Assess --> TeachAPI
    Progress --> TeachAPI

    DocAPI --> Documents --> Db
    DocAPI --> Rag
    RagAPI --> Rag
    TeachAPI --> Teach
    VideoAPI --> Video
    SpeechAPI --> Sarvam

    Rag --> Local
    Rag --> Sarvam
    Teach --> Sarvam
    Teach --> Rag
    Video --> Sarvam
    Video --> Local
    Teach --> Db
    Video --> Db
    Rag --> Db

    Sarvam --> SarvamAPI
```

## Request path: upload → indexing → planning → scripting → narration →
## rendering → the interactive loop

This is the full path a judge exercises when they upload a chapter and start
a 20-minute lesson. Every Sarvam call is labelled.

```mermaid
sequenceDiagram
    participant U as Learner
    participant App as Next.js app
    participant Doc as lib/documents
    participant Rag as lib/rag
    participant Teach as lib/teach
    participant Video as lib/video
    participant Sarvam as Sarvam AI

    U->>App: Upload PDF/DOCX/PPTX
    App->>Doc: parseDocument()
    Doc-->>App: sections/pages -> paragraphs
    App->>Rag: chunk() + index in background
    Rag->>Rag: local MiniLM embeddings (no Sarvam call)
    Rag-->>App: document_chunks.embedding filled

    U->>App: "Beginner, 20 min, Hindi, Ohm's Law"
    App->>Teach: parseTeachingInstruction()
    Teach->>Sarvam: POST /v1/chat/completions (Understand)
    Sarvam-->>Teach: TeachingIntent (topic, level, minutes, language...)

    App->>Teach: POST /api/teach/sessions (Plan)
    Teach->>Rag: retrieve relevant chunks (BM25 + dense, RRF)
    Teach->>Sarvam: POST /v1/chat/completions (Plan: concepts + prereqs)
    Sarvam-->>Teach: concept drafts
    Teach->>Teach: topological sort -> ordered Concept[]
    Teach-->>App: 201, scriptingStatus: "pending"

    par background scripting, pooled 3 concepts at a time
        Teach->>Sarvam: POST /v1/chat/completions x2 per concept\n(Explain/Demonstrate + Example/Question, parallel)
        Sarvam-->>Teach: beats + checkpoint question
    end
    App->>Teach: GET /api/teach/sessions/:id (poll)
    Teach-->>App: scenes as they finish, scriptingStatus: "ready"

    U->>App: Watch the segment
    App->>Video: POST /api/video {lessonPlanId}
    Video->>Sarvam: POST /text-to-speech per scene (bulbul:v3)
    Sarvam-->>Video: base64 WAV -> amplitude envelope
    Video->>Video: render visual (KaTeX/Shiki/Mermaid/plotter/SVG/HTML)
    Video->>Video: compose avatar + visual + captions (headless Chromium)
    Video->>Video: capture frames -> ffmpeg mux -> scene MP4 -> concat
    Video-->>App: GET /api/video/:jobId, downloadUrl when completed

    U->>App: Answer checkpoint (type or voice)
    App->>Sarvam: POST /speech-to-text (if voice)
    App->>Teach: POST /api/teach/sessions/:id/answer (Evaluate)
    Teach->>Sarvam: POST /v1/chat/completions (verdict + named misconception)
    alt wrong or partial
        Teach->>Sarvam: POST /v1/chat/completions (Adapt: new analogy, example, question)
        Sarvam-->>Teach: re-explanation scene + follow-up question
        Teach-->>App: adaptation payload - UI renders re-teach and new checkpoint
    else correct
        Teach-->>App: evaluation only - lesson continues
    end

    U->>App: "Ask anything" / "ab hindi mein samjhao"
    App->>Teach: POST /api/teach/sessions/:id/ask (Continue)
    Teach->>Rag: retrieve() + isRelevant() gate
    Teach->>Sarvam: POST /v1/chat/completions (grounded or general-knowledge answer)
    Teach-->>App: answer + grounded flag + citations, OR language switch applied

    U->>App: Finish lesson
    App->>Teach: POST /api/teach/sessions/:id/assess then /assess/submit
    Teach->>Sarvam: POST /v1/chat/completions (quiz, then report prose)
    Teach-->>App: AssessmentReport (score/weak areas computed in code)
```

## Why this shape

- **Plan/persist split** (`session.ts`): `POST /api/teach/sessions` only
  races the model call against a deadline, then persists synchronously — an
  abandoned slow plan can never commit a session nobody holds the id for.
  Scripting every concept then runs in the background (bounded 3-at-a-time
  pool), and the client polls `scriptingStatus`. This exists because an
  earlier single-call design measured at 273s and then failed outright — see
  the reasoning-token-budget note in [05](05-ai-ml-models.md).
- **The video pipeline holds no whole-lesson buffer**: one browser + one
  capture page, frames written to disk and deleted right after each scene's
  `ffmpeg` encode, final concat via `ffmpeg -c copy` (stream copy, no
  re-encode). Cost is per-scene, not per-lesson.
- **The lesson player renders one segment at a time**, not the whole
  multi-concept lesson up front — adaptation scenes don't exist until the
  learner actually answers wrong, so pre-rendering everything would be
  wasted work most of the time.
- **Every DB write goes through a typed accessor** (`lib/db/accessors/*`, one
  per table) — no raw SQL anywhere else in the codebase. Schema and cascade
  rules: `docs/SCHEMA.md`.

## Data model (summary)

`learner_profiles` → `lesson_sessions` → `lesson_plans`/`concepts` →
`scenes`/`questions` → `student_answers`/`concept_adaptation_state` →
`assessment_reports`, plus `documents`/`document_chunks`/`document_outlines`
for uploaded material, `concept_progress` for cross-session personalisation,
`learning_paths` for broad topics, and `video_jobs` for render tracking. Full
column-level detail, foreign keys and cascade behaviour: `docs/SCHEMA.md`.
