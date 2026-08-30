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

Parsing an upload into a structure-preserving `ParsedDocument` with citable
locations is `lib/documents/`'s job; everything from retrieval chunking onward
is `lib/rag/`, below.

### RAG slice — implemented (`lib/rag/`)

- **Chunking** (`lib/rag/chunk.ts`): a second, retrieval-tuned chunker —
  the upload route now calls this one instead of the original
  `lib/documents/chunk.ts` — that overlaps chunks across a semantic boundary
  (whole trailing paragraphs carried forward, never a mid-sentence cut) and
  builds a heading breadcrumb (`"Chapter 4 > Ohm's Law"`) from DOCX/Markdown's
  real heading levels (`ParsedSection.level`, added for this).
- **Embeddings** (`lib/rag/embed.ts`): `@xenova/transformers`,
  `Xenova/all-MiniLM-L6-v2`, 384-dim, mean-pooled and L2-normalized, run
  entirely locally. The ONNX weights (~23MB, quantized) download once and
  cache under `.cache/transformers/` (gitignored); every chunk's vector is
  computed once and written to `document_chunks.embedding` (a Float32 BLOB),
  so reopening an already-indexed document is instant — retrieval only ever
  reads. Indexing runs in batches, updates the DB after each batch (so
  progress survives a crash), and is fired in the background from the
  upload route; `GET /api/documents/[id]/index` polls
  `getIndexingProgress()` (computed live from `document_chunks`, not
  in-memory state) for the UI (`app/rag-demo/page.tsx`).
- **Hybrid retrieval** (`lib/rag/retrieve.ts`): BM25 (`lib/rag/bm25.ts`,
  hand-rolled — no dependency, Unicode-aware tokenizer including combining
  marks so Devanagari/etc. tokenize correctly) fused with cosine similarity
  via Reciprocal Rank Fusion, not weighted score blending — RRF only needs
  each method's rank order, sidestepping the fact that BM25 and cosine
  similarity live on incomparable, corpus-dependent scales. Each result
  keeps its raw `denseScore` (cosine, not the fused rank) specifically for
  grounding's relevance gate below.
- **Grounding** (`lib/rag/ground.ts`): retrieves, and either answers
  strictly from the retrieved excerpts (sarvam-105b, instructed to cite
  `[1]`/`[2]`/etc. and never use outside knowledge) or refuses honestly. The
  refusal is gated on a **code-enforced threshold** on the best raw cosine
  similarity in the retrieved set (`DENSE_RELEVANCE_THRESHOLD`, currently
  0.32 — see `evals/README.md` for how it was tuned), not on the model's own
  judgement — sarvam-105b's pretraining likely "knows" things like Ohm's Law
  regardless of what the uploaded material says, so refusal can't be left to
  it deciding whether to comply with a system prompt. The gate reads the
  maximum rather than `retrieved[0]`, because the fused RRF order can rank a
  weaker dense match first. Verified live end to end (`npm run eval:rag`;
  see `evals/`).
- **Cross-language retrieval**: all-MiniLM-L6-v2 is English-tuned, so a
  Hindi query embedded directly against English chunks (or the reverse)
  scores near-random, and BM25 has zero token overlap across scripts.
  Decision: translate the **query** (not the corpus) into the document's
  detected language via Sarvam's real `/translate` before retrieval
  (`lib/rag/language.ts`); retrieved excerpts stay in the source language,
  and sarvam-105b — fluent across English and the supported Indic languages
  — reads them directly and writes the answer in whatever language the
  learner asked in, in one chat call. Document language is detected once at
  index time from a text sample via Unicode script ranges (Devanagari →
  Hindi, Bengali, Tamil, Telugu, Kannada, Malayalam, Gujarati, Gurmukhi;
  Latin → English) and stored on `documents.language`. Verified live for
  English material / Hindi (Devanagari) query in both `npm run eval:rag` and
  manually against a real upload.
- **Chapter/concept extraction** (`lib/rag/outline.ts`): chapter boundaries
  are found structurally and for free — DOCX/Markdown heading levels, or a
  "Chapter N"/"Unit N" marker for PDF/PPTX (falling back to one chapter for
  the whole document when no marker is found). Concepts, definitions and
  worked examples inside each chapter need real reading comprehension, so
  that part is one `json<T>()` call per chapter, sequential (not
  concurrent, to stay under whatever per-key rate limit Sarvam holds), with
  one chapter's failure not failing the rest. Stored per document
  (`document_outlines`, migration v2) and generated lazily on first request
  (`GET /api/documents/[id]/outline`) rather than at upload time, since
  outline extraction is an LLM call per chapter and not every session needs
  it immediately.

Demo surface: `app/rag-demo/page.tsx` (upload → indexing progress → outline
→ ask, independent of the lesson-planner UI, which owns `app/page.tsx`).

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
into a `LessonPlan`), the lesson player/video UI, and the assessment/adaptation
logic. RAG retrieval (embeddings + BM25 fusion + grounding) is implemented —
see "RAG slice — implemented" above and `lib/rag/`.

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
- **Hinglish retrieval only works when the query's key terms are actual
  English words** ("explain the circuit ka concept"). `lib/rag/language.ts`
  treats `hinglish` as English for both document-language detection and
  query translation (see `LanguageCode`'s doc comment in `lib/types.ts`) —
  correct for English material asked about in English-with-Hindi-flavour,
  but a query whose key nouns are *transliterated* Hindi in Latin script
  ("karant kya hota hai" for "what is current") has zero token overlap with
  English chunks for BM25, and MiniLM doesn't understand transliterated
  Hindi as equivalent to the English word either — so that query is
  correctly-but-unhelpfully treated as unrelated. Verified live: real
  Devanagari Hindi ("विद्युत धारा क्या है?") retrieves correctly against
  English material; transliterated Hinglish for a term with no English
  cognate in the query does not. A dedicated transliteration step (Latin
  Hindi → Devanagari before the existing translate path) would fix this;
  out of scope for this slice.
- **Outline extraction (`lib/rag/outline.ts`) needs the original upload on
  disk** (`lib/documents/storage.ts`, `data/uploads/`, gitignored) — it
  re-parses the source file rather than reconstructing structure from
  already-chunked text. If that file is ever missing (moved/deployed
  environment without it), `GET /api/documents/[id]/outline` returns 409
  rather than silently fabricating an outline.
- **PDF chapter titles can be truncated.** Chapter detection for PDF/PPTX
  looks for a "Chapter N"/"Unit N" marker in a section's first line
  (`lib/rag/outline.ts`'s `chapterMarkerIn`). Real PDFs typically have a
  blank line between a heading and its body, which `pdf-parse` preserves as
  a paragraph break — but when it doesn't (observed with some
  programmatically generated PDFs, including this slice's own eval
  fixture), the heading and the whole page's body text merge into one
  "line", and the title is hard-truncated at a word boundary (80 chars) to
  contain the damage. Bounded rather than exact in that case; the *chapter
  grouping* (which page belongs to which chapter) is unaffected either way.
  `evals/fixtures/electricity-basics.pdf` demonstrates this exact case.
- **No CI workflow is wired up.** GitHub Actions currently refuses to start
  any job on the account this repo is hosted under ("recent account payments
  have failed or your spending limit needs to be increased") — an account
  billing block, not a repo or code problem. A red check would block every PR
  from merging with no way to go green, which is worse than no check at all,
  so `.github/workflows/ci.yml` was deliberately left out rather than
  committed and left permanently failing. Run `npm run typecheck`, `npm run
  lint`, `npm test` and `npm run build` locally before pushing until Actions
  billing is restored, then add the workflow back.
