# AI Teacher — project knowledge

Read `docs/ARCHITECTURE.md` first — it is the settled architecture (credentials,
verified Sarvam endpoint contracts and gotchas, the teaching loop, what's judged)
and takes precedence over anything below. `docs/SCHEMA.md` documents the database.
`docs/submission/` is the jury-facing submission documentation (problem statement
through known limitations, per the assessment's Section 20) — written for an
external reader, not a contributor, so prefer `docs/ARCHITECTURE.md`/`docs/SCHEMA.md`/
`docs/VIDEO.md` as the engineering source of truth and treat `docs/submission/`
as downstream of them, not the other way around.

## Non-obvious setup facts

- **Next.js is pinned to 15.x on purpose** (`^15.5.24`), not the `next@latest`
  (16.x) that `create-next-app` installs by default. The architecture calls for
  Next 15 specifically; don't let a dependency bump silently move to 16 —
  `npm audit fix --force` will try to, over two dev-toolchain-only `postcss`
  advisories that are an accepted tradeoff (Known limitations in
  `docs/ARCHITECTURE.md`).
- `next.config.ts` sets `serverExternalPackages` for `better-sqlite3`,
  `pdf-parse`, `pdfjs-dist`, `mammoth`, `@xenova/transformers`,
  `onnxruntime-node`, `sharp`, `playwright`, `mermaid`, and `katex`. Without
  this, `pdf-parse` (which bundles `pdfjs-dist`) breaks under Next's RSC
  webpack layer with `TypeError: Object.defineProperty called on non-object`,
  and the video renderers lose the on-disk package layout they read assets
  from — any new native-binding, CJS/ESM-interop-fragile, or
  own-package-layout-reading package added under `lib/` should be added here
  too rather than debugged from scratch.
- `SARVAM_API_KEY` is the only AI credential this project uses; `.env.example`
  documents it. Never invent a dependency on another paid API.
- Native modules (`better-sqlite3`, `protobufjs`, and the `sharp` nested under
  `@xenova/transformers`, without which `lib/rag/embed.ts` throws at module
  load) need `npm approve-scripts <pkg>` in this environment before `npm
  install` will run their build step — see the `allowScripts` block in
  `package.json`. Run it once per package, not once for the whole pending
  list: `npm approve-scripts <pkg>` rewrites `package.json`'s `allowScripts`
  block to contain *only* the package just approved, silently dropping every
  other entry that was there — verified live on a clean checkout. If `git
  diff package.json` shows the block shrank afterward, `git checkout --
  package.json` restores it (the native modules stay built; only the
  tracking file needs restoring).
- `lib/rag/embed.ts`'s embedding model (`Xenova/all-MiniLM-L6-v2`) downloads
  once to `.cache/transformers/` (gitignored, ~23MB) on first use — needs
  network the very first time; every run after that is offline.
- **Teaching-video generation needs a browser and `ffmpeg` that `npm install`
  does not provide**: `npx playwright install chromium` once per machine (the
  `playwright` package ships no postinstall hook in this version — see
  `docs/VIDEO.md`), and `ffmpeg` on `PATH` (invoked as a subprocess, not an
  npm dependency).
- **`sarvam-105b` burns its `max_tokens` budget on `reasoning_content` before
  writing any `content`.** Measured live: reasoning alone can run 26,000-
  34,000 characters, so a call budgeted below that returns `finish_reason:
  "length"` with content EMPTY — not a model failure, a budget too small to
  ever have room for output. `reasoning_effort`/`thinking`/
  `max_reasoning_tokens` do not reliably control this (tested live; one even
  made it worse) — don't spend time on them. `lib/sarvam/config.ts`'s
  `DEFAULT_MAX_TOKENS` (28,000) and `DEFAULT_TIMEOUT_MS` (90s) already
  account for this; a call that's unusually large should still be split into
  smaller independent calls fired in parallel (see `script.ts`'s
  `scriptConcept()`) rather than raising the budget further.
- **`sarvam-105b`'s JSON mode does not infer your schema from prose.**
  `response_format: json_object` only guarantees valid JSON, not your field
  names — verified live, a prompt that just *describes* the desired content
  got plausible-but-wrong keys back. Every structured prompt needs an
  explicit `"Respond with ONLY a JSON object of exactly this shape: {...}"`
  block naming every key. Every `lib/teach` call goes through
  `lib/teach/llm.ts` (not `lib/sarvam` directly), which adds one bounded
  retry on a malformed/truncated response — see `docs/ARCHITECTURE.md`'s
  "Real-behaviour fixes" for the full list. A raw language code like
  `"en-IN"` alone is also not a reliable instruction; use
  `lib/teach/profile.ts`'s `languageInstruction()`.
- **`POST /api/teach/sessions` returns as soon as planning finishes** (not
  after the whole lesson is scripted) — poll `GET /api/teach/sessions/:id`'s
  `scriptingStatus` until it's `"ready"`/`"partial"`/`"failed"`. Don't
  reintroduce a blocking all-in-one session creation call; that's the
  multi-minute, single-point-of-failure design this replaced.

## Structure

- `lib/sarvam/` — the only place that talks to Sarvam. `chat()`/`json<T>()`/
  `textToSpeech()`/`translate()`/`speechToText()`/`checkHealth()`, typed
  `SarvamError` with a `kind` field. Route everything through here rather than
  calling `fetch()` against Sarvam directly.
- `lib/documents/` — `parseDocument(buffer, filename)` dispatches by extension
  to a structure-preserving `ParsedDocument` (sections/pages → paragraphs);
  `saveUploadedFile`/`readUploadedFile` (`data/uploads/`, gitignored) persist
  the original bytes, needed because outline extraction re-parses them.
- `lib/rag/` — the RAG/knowledge-grounding slice: `chunk.ts` (retrieval
  chunking, overlap + heading breadcrumbs), `embed.ts` (local MiniLM
  embeddings + `document_chunks.embedding` caching + indexing progress),
  `bm25.ts` (lexical scoring), `retrieve.ts` (hybrid BM25+dense via RRF),
  `ground.ts` (the seam other slices call: retrieve → answer with citations,
  or refuse honestly — gated on a code-enforced cosine-similarity threshold,
  not the LLM's judgement), `language.ts` (cross-language query translation),
  `outline.ts` (chapter/concept/definition/example extraction, cached in
  `document_outlines`). Full rationale and known limitations:
  docs/ARCHITECTURE.md's "RAG slice — implemented" section.
  `npm run eval:rag` runs a real end-to-end quality check against a
  committed fixture (`evals/`) — see `evals/README.md`.
- `lib/db/` — `getDb()` (migrates on first call) plus one accessor module per
  table under `lib/db/accessors/`. No raw SQL outside that directory.
- `lib/types.ts` — the shared domain contracts (`LearnerProfile`, `LessonPlan`,
  `Concept`, `Scene`, `VisualSpec`, `Question`, `AnswerEvaluation`,
  `Misconception`, `AssessmentReport`, `LearningPath`). Every slice codes
  against these; changing a field here is a cross-slice breaking change.
- `lib/teach/` — the teaching engine: Understand → Plan → Explain/Demonstrate/
  Question → Evaluate → Adapt → Continue, one module per step, orchestrated
  by `session.ts` and exposed under `app/api/teach/`. See `docs/ARCHITECTURE.md`'s
  "The teaching engine" section for the module table and API surface.
- `lib/video/` — turns a `LessonPlan`/`Scene[]` into an MP4: narration+envelope
  (`narrate.ts`), subject-aware visual renderers (`visuals/`, one file per
  renderer — katex/shiki/mermaid/plotter/svg/html — dispatched by
  `visuals/index.ts`), the SVG avatar (`avatar/`), page composition
  (`compose.ts`), and Chromium-capture + ffmpeg encoding (`render.ts`,
  `ffmpeg.ts`). Every captured frame is a pure function of a logical
  timestamp — **never add a CSS `transition`/`@keyframes` to a composed
  page**, it runs on wall-clock time and breaks deterministic frame capture
  and per-scene caching. `VisualSpec.content`'s per-renderer format contract
  is documented in `docs/VIDEO.md`, not here. `render.ts`'s `sceneIds` option
  renders a named subset of a plan's scenes rather than the whole thing — the
  lesson player uses this to render one teaching segment at a time.
- `app/learn/[id]/` — the student-facing lesson player: plan review, the
  video-segment-by-segment player with checkpoints/adaptation/ask-anything,
  assessment and report. `app/page.tsx` is the entry screen (intent parsing
  + confirmation), `app/progress/` the cross-session dashboard, `app/paths/`
  a learning path's steps. See `docs/ARCHITECTURE.md`'s "The student
  experience" section. `lib/client/learner.ts` holds the single-learner
  identity (a profile id in `localStorage`) these pages share.

## Testing

`npm test` runs vitest (`__tests__/`). DB tests set `DB_PATH=":memory:"` and call
`resetDbForTests()` between tests for isolation. Sarvam client tests mock
`fetch` with `vi.stubGlobal` — when a test calls the mocked endpoint more than
once, use `mockImplementation` (a fresh `Response` per call) rather than
`mockResolvedValue` with a single `Response` object, since a `Response` body
can only be read once. `lib/teach` tests use `__tests__/support/sarvamMock.ts`'s
`stubChatSequence(...payloads)` for the same pattern, one payload per expected
call in order. Video-pipeline tests (`video-narrate`/`video-render`) follow the
same fetch-mocking pattern for the Sarvam TTS boundary, plus set
`VIDEO_CACHE_DIR` to a fresh per-test tmp dir; `video-mermaid`/`video-render`
launch a real headless Chromium and (for `video-render`) shell out to real
`ffmpeg`/`ffprobe` — everything downstream of the mocked network call is
exercised for real, on purpose.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
