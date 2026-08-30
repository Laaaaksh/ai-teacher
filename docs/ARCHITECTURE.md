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
  in-memory state) for the UI (`app/rag-demo/page.tsx`), and `POST` on the
  same route re-runs indexing for whatever chunks still lack an embedding —
  idempotent, for recovering an index interrupted by a restart.
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
  see `evals/`). Later slices call `ground()` directly; `POST /api/rag/ask`
  (`{ documentId, question, languageCode }` → the `GroundedAnswer`) exposes
  the same seam over HTTP so the capability is demoable on its own.
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
  backoff on 429/5xx only — a 200 whose body isn't JSON fails as
  `invalid-response-body` (a distinct kind from `invalid-json`, the model's own
  output being unparseable) rather than being re-POSTed against a request
  Sarvam already billed — and a
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

Deliberately **not** in this slice: the lesson player/video UI. RAG retrieval
(embeddings + BM25 fusion + grounding) is implemented — see "RAG slice —
implemented" above and `lib/rag/`; the lesson planner and the assessment/
adaptation logic are `lib/teach/` (below).

## The teaching engine (`lib/teach/`)

Implements the teaching loop end to end as explicit state (not one long
prompt), matching the module names to the loop's steps:

| Step | Module | What it does |
|---|---|---|
| Understand | `profile.ts` | Free-text instruction ("teach me Chapter 4 in 20 minutes in Hindi...") + the stored `LearnerProfile` → a structured `TeachingIntent`, via `sarvam-105b` (not regex) so an instruction that doesn't map to a simple pattern still works. Also `detectLanguageSwitch()` for "ab hindi mein samjhao" mid-lesson. |
| Plan | `plan.ts` | Topic or document chunks → ordered `Concept[]`. `deriveStructure(totalMinutes, depth)` changes lesson *structure* on two independent axes: duration (essential/structured/deep bucket, `includePracticeConcept`) and the learner's requested `depth` (a 0.7x/1x/1.3x concept-count multiplier plus prompt guidance — `overview` stays high-level and skips derivations, `deep` asks for the underlying mechanism, precise terminology and implementation detail). Concepts are sequenced by a real topological sort over model-proposed prerequisites (`prerequisiteTitles`) — the model proposes edges, code guarantees the order, breaking any cycle rather than trusting it. Citations are built from the actual retrieved chunk text, never from a model-invented excerpt. |
| Explain/Demonstrate/Question | `script.ts` | One concept → introduction/explanation/example/checkpoint/transition beats, from two INDEPENDENT LLM calls fired via `Promise.all` (introduction+explanation; example+checkpoint+transition) rather than one — no added wall-clock time, and each call's smaller schema reasons less and is less likely to truncate (see the token-budget fix below). `chooseVisualKind(subject, beat)` is a plain lookup table (not an LLM call) — the same (subject, beat) pair always yields the same visual kind and the same written rationale, so the decision is inspectable per the spec's "demonstrate how the system decides." Only the visual's *content* (LaTeX/Mermaid/code) is model-generated. The checkpoint beat gets its OWN visual content, explicitly instructed not to contain the worked answer — it used to reuse the explanation's full derivation, which could hand the learner the answer to the question testing it. The explanation beat's `analogyLabel` is what `adapt.ts` tracks to avoid repeating itself. |
| Evaluate | `evaluate.ts` | Judges an answer against the concept: `correct`/`partial`/`incorrect` plus a *named* misconception on anything short of correct — the zod schema requires it via `.refine()`, so "just wrong" can't validate. An exact MCQ match to the reference answer short-circuits to `correct` without a model call (deterministic, not a stub — there's nothing to judge). |
| Adapt | `adapt.ts` | On incorrect/partial: re-explains with a genuinely different analogy (checked against every analogy already spent on this concept this session — `lib/db/accessors/adaptationState.ts`, seeded at scripting time with the original explanation's analogy so even the *first* miss can't repeat it), a new example, a fresh question at an adjusted difficulty. If the model reuses a banned analogy anyway, one repair round is fired before falling through. A second consecutive miss on the same concept drops to its prerequisite instead of a third attempt at the same content. |
| Continue (follow-ups) | `ask.ts` | Answers a mid-lesson interruption grounded in the source document/lesson without touching `lesson_sessions.current_scene_order`, so the lesson resumes exactly where it was. Grounding is a small local lexical (term-overlap) scorer over `document_chunks` — see Known limitations below for why, not the RAG slice's embeddings. This does **not** hard-refuse an off-document question: when nothing scores above the relevance floor it says so, then still answers from general knowledge — the anti-hallucination contract is `FollowUpAnswer.grounded` (computed from retrieval results, not the model's own wording), a machine-checkable signal a caller can always trust regardless of how the model phrased the answer. |
| Continue (assessment) | `assess.ts` | Final quiz drawn from the taught concepts (weighted toward ones missed at checkpoints), then a report. Score/weak-areas/misconceptions-held/concepts-understood are computed **deterministically** from recorded verdicts; the model only phrases `recommendedRevision`/`suggestedNextTopic`, grounded in those computed facts, never inventing a weak area that wasn't measured. |
| Continue (paths) | `path.ts` | Broad topic ("teach me machine learning") or explicit multi-day request → an ordered `LearningPathStep[]`, first step unlocked, rest locked; `unlockNextStep()` advances it. Each step's own `LessonPlan` is generated lazily by `plan.ts` when the learner actually starts it. |
| Orchestration | `session.ts` | Wires Plan → Explain/Demonstrate/Question → persistence, split into a FAST phase and a BACKGROUND phase. `planTaughtLessonSession()` does one planning call (verified live: ~50s for a 3-concept lesson — a single request, not the old design's minutes) and persists `lesson_session`/`lesson_plan`/`concepts` in one transaction. `scriptTaughtLessonSession()` scripts concepts **concurrently but pooled** (a bounded 3-at-a-time fan-out, not a sequential loop and not one request per concept all at once — the calls are independent, but each concept is itself two large calls, so a 12-concept plan would otherwise burst 24 requests into a rate limit; verified live: ~94s to script all 3 concepts, in the background, not blocking the caller) and persists scenes/questions/adaptation-state as each one finishes; a single concept's failure is isolated (recorded in `scripting_error`, that concept just has no scenes) rather than failing the whole lesson. `lesson_sessions.scripting_status` (`pending`→`in_progress`→`ready`\|`partial`\|`failed`) is what a caller polls. This split exists because the old single-call design took 273s in one live-measured run and then failed outright — see the fixes below. |
| Shared | `llm.ts` | Every `lib/teach` structured call goes through this thin wrapper around `lib/sarvam`'s `json()` rather than calling it directly — see the token-budget/timeout note below. |

### API surface (`app/api/teach/`)

`POST /intent` (parse instruction) · `POST /sessions` (**plans** the lesson
and returns as one request — verified live at ~50s for 3 concepts, not the
old design's 273s-then-fail — with `scriptingStatus: "pending"`; scripting
then runs in the background, verified live at ~94s more for those 3
concepts, in parallel) · `GET /sessions/[id]`
(session + plan + whatever scenes have scripted so far + `scriptingProgress`
+ answers — poll this until `scriptingStatus` is
`"ready"`/`"partial"`/`"failed"`) · `POST /sessions/[id]/answer` (evaluate +
adapt) · `POST /sessions/[id]/ask` (grounded follow-up / language switch) ·
`POST /sessions/[id]/assess` then `POST /sessions/[id]/assess/submit`
(generate quiz, then grade it and produce the report) · `POST /paths` (broad
topic / multi-day). A judge or the lesson-player slice can drive a complete
session — plan from a topic or an uploaded document, teach it, get asked a
question, answer wrongly and watch it re-explain differently, finish with a
report naming real weak areas — through this surface alone.

### Real-behaviour fixes this slice made, all found by running the actual teaching loop against the live API (not assumed)

**The reasoning-token budget was the root cause of both the slowness and the
outright failures.** `sarvam-105b` spends its `max_tokens` budget on
`reasoning_content` FIRST and only then writes `content`. Measured live on a
heavy structured call: reasoning alone ran 26,000-34,000 characters (roughly
6,500-8,500 tokens), so a call budgeted at `max_tokens: 8000` returned
`finish_reason: "length"` with **content completely empty** three times out
of four — not a model failure, a budget that never had room for output at
all. `reasoning_effort`, `reasoning.effort`, `thinking: false` and
`max_reasoning_tokens` were all tested live against the same prompt: none is
rejected, and none reliably reduces reasoning (`reasoning_effort: "low"`
produced *more* reasoning than the baseline, 8,834 vs 5,905 characters) — do
not spend time on them. The two real levers, both applied here:

1. **Budget for it.** `lib/sarvam/config.ts`'s `DEFAULT_MAX_TOKENS` raised
   from 4096 to **28,000** — on the order of the 24,000-32,000 range the
   measurement calls for — and `DEFAULT_TIMEOUT_MS` from 30s to 90s to match
   (a call that size, verified live, averages ~47s). This is a shared
   `lib/sarvam` default, not a `lib/teach`-only override, because every
   slice calling `sarvam-105b` hits the same reasoning cost. Re-verified at
   this value: **4/4 succeeded** on the exact prompt shape that failed 3/4
   times at 8000, averaging 47s.
2. **Ask for less per call.** `script.ts`'s `scriptConcept()` now fires two
   smaller calls in parallel instead of one large one (see the table above)
   — this is each caller's own responsibility, not something raising the
   shared default alone fixes, since a call can still be arbitrarily large.
3. `lib/teach/llm.ts` adds one bounded outer retry (on top of `lib/sarvam`'s
   existing one internal repair attempt) specifically for `truncated`/
   `invalid-json`/`invalid-schema` — a safety net for a genuinely malformed
   response, not the primary fix; it does not retry `timeout`/`http`/
   `network`/`config` errors, where a same-request retry wouldn't help, nor
   `invalid-response-body`, where the request was already processed and
   billed. Because retries multiply attempts, the retry is bounded twice:
   `llm.ts` gives one structured ask a 150s wall-clock budget (it skips the
   retry, or shortens its timeout, once the budget is nearly spent), and
   `runLlm()` caps any request-path route at a 180s deadline, answering 504
   with `kind: "deadline-exceeded"` instead of holding the caller open.

Two smaller fixes, also found live:

4. **A JSON-mode response still needs the exact key names spelled out.**
   `json<T>()`'s `response_format: json_object` makes the model emit valid
   JSON, but not necessarily matching the caller's zod schema — verified
   live, a prompt that only *describes* the desired fields in prose got a
   plausible-but-wrong shape back (`description`/`bucket`/`examples` instead
   of `summary`/`subject`/`difficulty`/`visualContent`/`visualCaption`).
   Every `lib/teach` prompt now ends with an explicit `"Respond with ONLY a
   JSON object of exactly this shape: {...}"` block naming every key.
5. Language codes like `"en-IN"` alone weren't a reliable instruction either
   — verified live, the model sometimes wrote Hindi despite an `en-IN`
   request. `lib/teach/profile.ts`'s `languageInstruction()` names the
   language in words ("Write in English (language code \"en-IN\").") and
   every module routes through it instead of interpolating the raw code.

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
- **`lib/documents/chunk.ts` is dead code, retained on purpose.** The upload
  route calls `lib/rag/chunk.ts` now, so the original chunker has no
  production caller — but the two other in-flight slices (`ait-engine`,
  `ait-video`) branched off the pre-RAG foundation, where the upload route
  still imports it. Deleting it here would break them when the stack
  flattens, so it and its tests stay until that flattening lands on `main`,
  and should be deleted then.
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
- **`lib/teach/ask.ts`'s grounding is a local lexical (term-overlap) scorer
  over `document_chunks`, not the RAG slice's embeddings+BM25 fusion.** It's
  a real anti-hallucination mechanism (it does refuse to ground an answer
  when nothing scores above the relevance floor), but it's keyword overlap,
  not semantic search — a question that paraphrases the material without
  sharing its vocabulary can miss a genuinely relevant chunk. Swap in the RAG
  slice's retrieval (`lib/rag/ground.ts`) here; the call site
  (`retrieveRelevantChunks`) is a single, isolated function.
- **`lib/teach/plan.ts` grounds a lesson plan against a document by feeding
  the model up to ~16,000 characters of raw chunk text**, not a semantic
  retrieval pass — reasonable for "Chapter 4" (narrowed by
  `filterChunksBySectionHint`) on typical chapter lengths, but a very long
  chapter or an un-sectioned document gets truncated rather than
  intelligently summarized.
- **The prerequisite-drop in `adapt.ts` only looks within the current lesson
  plan's concepts** (`concept.prerequisiteConceptIds`), not across sessions
  or the broader learning path — a concept whose real prerequisite was taught
  in an earlier session has nothing to drop to here.
- **`lib/teach/path.ts` step titles/summaries are not translated into the
  learner's teaching language** — they're navigational metadata, not taught
  content, so this was scoped out; each step's actual `LessonPlan` (generated
  lazily when the learner starts it) is fully multilingual via `plan.ts`.
- **Background scripting is in-process fire-and-forget, not a durable job
  queue.** `app/api/teach/sessions` kicks off `scriptTaughtLessonSession()`
  without awaiting it, relying on the Node process staying alive after the
  response is sent — true for `next dev`/`next start` (a persistent process,
  which this app is), false for a serverless/edge deployment. There's no
  external queue (no Redis, no worker), so a server restart mid-scripting
  leaves a session's `scripting_status` stuck at `'in_progress'` forever with
  no automatic recovery. Acceptable for a single-process hackathon demo;
  would need a real job queue for a multi-instance or serverless deployment.
- **No CI workflow is wired up.** GitHub Actions currently refuses to start
  any job on the account this repo is hosted under ("recent account payments
  have failed or your spending limit needs to be increased") — an account
  billing block, not a repo or code problem. A red check would block every PR
  from merging with no way to go green, which is worse than no check at all,
  so `.github/workflows/ci.yml` was deliberately left out rather than
  committed and left permanently failing. Run `npm run typecheck`, `npm run
  lint`, `npm test` and `npm run build` locally before pushing until Actions
  billing is restored, then add the workflow back.
