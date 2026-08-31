# AI Teacher — project knowledge

Read `docs/ARCHITECTURE.md` first — it is the settled architecture (credentials,
verified Sarvam endpoint contracts and gotchas, the teaching loop, what's judged)
and takes precedence over anything below. `docs/SCHEMA.md` documents the database.

## Non-obvious setup facts

- **Next.js is pinned to 15.x on purpose** (`^15.5.24`), not the `next@latest`
  (16.x) that `create-next-app` installs by default. The architecture calls for
  Next 15 specifically; don't let a dependency bump silently move to 16 —
  `npm audit fix --force` will try to, over two dev-toolchain-only `postcss`
  advisories that are an accepted tradeoff (Known limitations in
  `docs/ARCHITECTURE.md`).
- `next.config.ts` sets `serverExternalPackages` for `better-sqlite3`,
  `pdf-parse`, `pdfjs-dist`, and `mammoth`. Without this, `pdf-parse` (which
  bundles `pdfjs-dist`) breaks under Next's RSC webpack layer with
  `TypeError: Object.defineProperty called on non-object` — any new
  native-binding or CJS/ESM-interop-fragile package added under `lib/` should
  be added here too rather than debugged from scratch.
- `SARVAM_API_KEY` is the only AI credential this project uses; `.env.example`
  documents it. Never invent a dependency on another paid API.
- Native modules (`better-sqlite3`) need `npm approve-scripts <pkg>` in this
  environment before `npm install` will run their build step — see the
  `allowScripts` block in `package.json`.

## Structure

- `lib/sarvam/` — the only place that talks to Sarvam. `chat()`/`json<T>()`/
  `textToSpeech()`/`translate()`/`speechToText()`/`checkHealth()`, typed
  `SarvamError` with a `kind` field. Route everything through here rather than
  calling `fetch()` against Sarvam directly.
- `lib/documents/` — `parseDocument(buffer, filename)` dispatches by extension
  to a structure-preserving `ParsedDocument` (sections/pages → paragraphs);
  `chunkDocument()` turns that into citable retrieval chunks.
- `lib/db/` — `getDb()` (migrates on first call) plus one accessor module per
  table under `lib/db/accessors/`. No raw SQL outside that directory.
- `lib/types.ts` — the shared domain contracts (`LearnerProfile`, `LessonPlan`,
  `Concept`, `Scene`, `VisualSpec`, `Question`, `AnswerEvaluation`,
  `Misconception`, `AssessmentReport`, `LearningPath`). Every slice codes
  against these; changing a field here is a cross-slice breaking change.

## Testing

`npm test` runs vitest (`__tests__/`). DB tests set `DB_PATH=":memory:"` and call
`resetDbForTests()` between tests for isolation. Sarvam client tests mock
`fetch` with `vi.stubGlobal` — when a test calls the mocked endpoint more than
once, use `mockImplementation` (a fresh `Response` per call) rather than
`mockResolvedValue` with a single `Response` object, since a `Response` body
can only be read once.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
