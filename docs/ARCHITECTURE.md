# AI Teacher — architecture

Built for the Bharat Academix AI Innovation Hackathon 2026, Round 2: an AI-powered
virtual teacher that understands uploaded material or a bare topic, plans a lesson,
teaches it as a generated video with a real voice and avatar, questions the
learner, evaluates and adapts, and produces a learning report. See the full brief
in the submission's round 2 technical assessment; the judged weighting is:

| Area | Weight |
|---|---|
| Human-like teaching and adaptation | 20 |
| AI/LLM implementation | 15 |
| RAG grounding | 15 |
| Teaching-video generation | 15 |
| Multilingual | 10 |
| Voice + avatar | 10 |
| Innovation | 5 |
| UX | 5 |
| Documentation | 5 |

The spec is explicit, twice, in bold: **a chatbot, a static video, or an avatar
reading a generated script is not a passing solution.** Every part of this system
is built to demonstrate the full teaching loop, not just answer questions.

## Credentials

`SARVAM_API_KEY` is the only AI credential this project uses or needs. There is
no Anthropic, OpenAI, ElevenLabs, HeyGen, D-ID key, and no local Ollama —
everything else is local, key-free computation (SQLite, local embeddings,
ffmpeg, headless Chromium). Do not add a dependency on a paid API this project
does not hold a key for.

### Verified Sarvam endpoints

Auth header on every call: `api-subscription-key: <key>`.

| Need | Endpoint | Notes |
|---|---|---|
| LLM | `POST https://api.sarvam.ai/v1/chat/completions`, model `sarvam-105b` | OpenAI-shaped. **Reasoning model**: fills `reasoning_content` before `content`. A tight `max_tokens` returns `finish_reason: "length"` with `content: null` before real output is written. `lib/sarvam` defaults to a generous `max_tokens` (4096) and throws a typed `truncated` error instead of returning an empty string — verified live against the real API (see `lib/sarvam/client.ts`). |
| TTS | `POST https://api.sarvam.ai/text-to-speech`, model `bulbul:v3` | Returns `{"audios":["<base64 wav>"]}`; `lib/sarvam` decodes it to a `Buffer`. `speaker` is optional; **only `bulbul:v3` speakers** (aditya, ritu, priya, neha, rahul, kavya, ishita, shreya, varun, tanya, 38 total) — v2 speakers like `anushka` are rejected. |
| Translate | `POST https://api.sarvam.ai/translate` | `input`, `source_language_code`, `target_language_code` (e.g. `en-IN`, `hi-IN`). |
| STT | `POST https://api.sarvam.ai/speech-to-text` | multipart; for spoken student answers. |

**There is no Sarvam embeddings endpoint** (404 verified) — RAG embeddings must
run locally.

## Stack

- Next.js 15 (App Router), TypeScript strict, Tailwind v4. One app, easy to run
  and demo from `git clone` + `SARVAM_API_KEY`.
- SQLite via `better-sqlite3` for every piece of persisted state (learner
  profile, documents/chunks, sessions, plans, scenes, questions, answers,
  assessments, progress, learning paths). No external database. Schema and
  rationale: `docs/SCHEMA.md`.
- `ffmpeg` (installed) muxes the generated video; Playwright/headless Chromium
  captures frames server-side. (Both consumed by the video-generation slice,
  not by this foundation slice.)

## RAG

Local and key-free: `@xenova/transformers` (`all-MiniLM-L6-v2`, ONNX, cached
after first download) for embeddings, fused with BM25 lexical scoring for
retrieval. Every answer grounded in uploaded material must carry a citation
back to its source chunk (document, page/section — see `Citation` in
`lib/types.ts` and `document_chunks.page`/`section` in the schema). When
retrieval finds nothing relevant, the teacher says so rather than inventing
content — the anti-hallucination requirement, and it must be demonstrable, not
just asserted.

This foundation slice parses documents into structure-preserving chunks with
citable locations (`lib/documents/`) and stores them (`document_chunks`,
`embedding` column left `NULL`); the embeddings and BM25 fusion themselves are
the RAG slice's job.

## The teaching loop — the core of the grade

**Understand → Plan → Explain → Demonstrate → Question → Evaluate → Adapt → Continue**

Modelled explicitly as state (`lib/types.ts`), not as one long prompt:

1. **Learner profile** (`LearnerProfile`): level, prior knowledge, goal,
   preferred style, language, time available, depth.
2. **Lesson plan** (`LessonPlan`): ordered `Concept[]` with a time budget per
   concept, derived from the requested duration — 5 min / 20 min / 60 min /
   multi-day should change lesson *structure*, not just length.
3. **Scenes** (`Scene`): each concept expands into explanation/example scenes
   plus at least one checkpoint scene carrying a question.
4. **Evaluation** (`AnswerEvaluation`): the LLM judges a student answer against
   the concept, returning correct/partial/incorrect **plus a named
   misconception** when wrong — never just "wrong."
5. **Adaptation** (`AdaptationPlan`): an incorrect answer re-explains with a
   **different** analogy than the original scene, gives another example, and
   re-questions. Difficulty moves with performance
   (`AnswerEvaluation.difficultyAdjustment`).
6. **Assessment** (`AssessmentReport`): score, concepts understood, weak areas,
   misconceptions held, recommended revision, next topic.
7. **Learning path** (`LearningPath`): for a broad topic, an ordered path with
   the learner's position in it.

## Subject-aware visuals — an inspectable decision, not hand-waved

The planner classifies each concept's subject and picks a visual kind
(`Concept.subject`, `VisualSpec.kind`/`renderer`, with a required
`VisualSpec.rationale` string so the UI/docs can show *why* that visual was
chosen):

| Subject | Visual | Renderer |
|---|---|---|
| Mathematics | equations, step-by-step working, graphs | KaTeX + a plotter |
| Physics | force/circuit diagrams, formulas, processes | Mermaid + KaTeX |
| Biology | labelled diagrams, processes | Mermaid / labelled SVG |
| History | timelines, maps, events | Mermaid timeline |
| Programming | code, output, execution flow, architecture | Shiki + Mermaid |
| General | concept maps, comparison tables, bullets | Mermaid / HTML |

## Video generation

No avatar API key exists, so the avatar is rendered by this app, in-browser:

- Each scene: narration text → Sarvam TTS → WAV, plus a visual panel rendered
  as HTML.
- Avatar: an expressive SVG/canvas presenter with viseme lip-sync driven by the
  audio amplitude envelope, plus idle motion (blink, small head movement).
- Composition: avatar and the subject visual share the frame — the visual is
  the larger element. On-screen text/captions included (also an accessibility
  win).
- Capture frames headlessly (Playwright/Chromium), mux with the concatenated
  audio via ffmpeg into an MP4.

This is entirely the video-generation slice's scope; this foundation slice only
guarantees the TTS call it depends on (`textToSpeech()`) returns a decoded
`Buffer` reliably.

## Multilingual

Teaching language is chosen at profile time and switchable mid-lesson by asking
naturally ("ab hindi mein samjhao"); lesson state and progress must survive the
switch. Material in one language and teaching in another must work both ways.
Minimum supported: English, Hindi, Hinglish, Bengali, Tamil, Telugu, Marathi,
Kannada, Gujarati, Malayalam, Punjabi — see `LanguageCode` in `lib/types.ts`.
"Hinglish" is deliberately not a `/translate` target language code; it is
handled as English text with Hindi code-switching instructions to the chat
model.

## Non-negotiables

- Never commit a key. `SARVAM_API_KEY` comes from the environment; `.env.example`
  documents the one variable required.
- Real behaviour only. If something cannot work, it is documented here under
  Known limitations — never faked with a hardcoded response, a canned lesson,
  or a stub that pretends to call a model.
- Everything works from `git clone` + documented setup with only
  `SARVAM_API_KEY` (see README.md).

## What this foundation slice provides

- **App scaffold**: Next.js 15 App Router, TypeScript strict, Tailwind v4.
  `npm run dev|build|typecheck|lint|test` all pass.
- **`lib/sarvam/`**: a typed client for chat, TTS, translate, STT — the seam
  every later slice calls through. Generous default `max_tokens`, errors typed
  by `kind` (`SarvamErrorKind` in `lib/sarvam/errors.ts`), one retry with
  backoff on 429/5xx only — a 200 whose body isn't JSON fails as `invalid-json`
  rather than being re-POSTed against a request Sarvam already billed — and a
  `json<T>()` helper that validates structured output with zod and retries once
  with a repair prompt on malformed JSON or a schema mismatch. Verified against
  the real API during this build (reasoning content present, truncation error
  fires correctly with a tight `max_tokens`, TTS decodes to a playable WAV,
  translate round-trips English → Hindi).
- **`lib/documents/`**: PDF/DOCX/PPTX/TXT/Markdown → a structure-preserving
  `ParsedDocument` (document → sections/pages → paragraphs) and a chunker that
  never splits a chunk across sections, so every chunk keeps one unambiguous
  citation. PDFs are kept as one section per page rather than concatenated into
  a single string, so real page numbers survive for citations (`pdf-parse`
  still materialises every page's text at once — see `lib/documents/parsePdf.ts`).
- **`lib/db/`**: `better-sqlite3` with a migration that runs on boot, one table
  per entity in the full product (not just tonight's slice — see
  `docs/SCHEMA.md`), and typed accessors; no other module writes raw SQL.
- **`lib/types.ts`**: the shared domain contracts every later slice codes
  against (`LearnerProfile`, `LessonPlan`, `Concept`, `Scene`, `VisualSpec`,
  `Question`, `AnswerEvaluation`, `Misconception`, `AssessmentReport`,
  `LearningPath`).
- **App shell**: a learner-profile form and a document-upload/topic entry
  point on the home page, wired end-to-end — uploading a real PDF/DOCX/PPTX
  parses it and persists both the document and its citable chunks. Uploads
  above 25 MB are rejected with a 413 rather than buffered.
- **`/api/health`**: real reachability of chat/TTS/translate/STT, each from an
  actual call, not a hardcoded "ok". A live result is cached for 30 s and
  replayed with a `cachedAgeMs` marker, so polling the endpoint doesn't burn
  four API calls per request.

Deliberately **not** in this slice: the lesson planner (turning a topic/document
into a `LessonPlan`), the lesson player/video UI, RAG retrieval (embeddings +
BM25 fusion), and the assessment/adaptation logic. Those are the three
dependent slices this foundation exists to unblock.

## Known limitations

- **PPTX slide order** is inferred from the numeric suffix of
  `ppt/slides/slideN.xml` rather than the presentation's relationship-ordered
  slide list. This matches the overwhelming majority of exporters (including
  PowerPoint and Google Slides) but would misorder a hand-edited deck whose XML
  filenames don't match display order.
- **Dev-toolchain vulnerability**: `next@15.5.24`'s bundled `postcss` has two
  known advisories (XSS in stringified CSS output, source-map path traversal).
  These affect the build tool, not the shipped app's runtime; `npm audit fix
  --force` would upgrade to Next 16, which the architecture calls for staying
  off of. Tracked, not silently ignored.
- **Health check's STT probe** posts a valid-but-silent WAV, so it verifies the
  endpoint is reachable and authenticated, not that transcription accuracy is
  good — a true accuracy check needs real speech audio, which a health check
  can't manufacture.
- No embeddings are computed yet (`document_chunks.embedding` is `NULL`) —
  by design, since Sarvam has no embeddings endpoint and this is the RAG
  slice's job.
- **No CI workflow is wired up.** GitHub Actions currently refuses to start
  any job on the account this repo is hosted under ("recent account payments
  have failed or your spending limit needs to be increased") — an account
  billing block, not a repo or code problem. A red check would block every PR
  from merging with no way to go green, which is worse than no check at all,
  so `.github/workflows/ci.yml` was deliberately left out rather than
  committed and left permanently failing. Run `npm run typecheck`, `npm run
  lint`, `npm test` and `npm run build` locally before pushing until Actions
  billing is restored, then add the workflow back.
