# AI Teacher

A human-like AI educator that teaches through video.

Upload a textbook, PDF, notes or slides — or just name a topic — and the AI Teacher
plans a lesson, teaches it as a generated video with a real voice and an avatar,
asks you questions as it goes, works out what you did not understand, and changes
how it teaches you.

Built for the Bharat Academix AI Innovation Hackathon 2026, Round 2.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in SARVAM_API_KEY
npx playwright install chromium   # one-time: teaching-video generation needs a real browser to render into
npm run dev
```

Requires Node 20+, and `ffmpeg` on `PATH` (used as a subprocess to mux teaching
videos — `brew install ffmpeg` / `apt install ffmpeg`). No database server,
vector DB, or other paid API is needed — SQLite lives on disk at
`data/ai-teacher.sqlite` and is created automatically on first run. Retrieval
embeddings run locally too: the first document you index downloads a ~23MB
MiniLM model to `.cache/transformers/` (gitignored), so that one run needs
network; every run after it is offline. See `docs/VIDEO.md` for why the
video-generation slice needs Playwright's browser downloaded separately from
`npm install`.

Open http://localhost:3000 for the student experience — upload material or
name a topic, describe how you want to be taught, and watch a real teaching
video with checkpoints — or http://localhost:3000/rag-demo to exercise
indexing → outline → grounded question answering with citations on its own.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run typecheck` — `next typegen && tsc --noEmit`; typegen must run first
  because Next 15 emits the typed-routes globals (`LayoutProps`, `PageProps`)
  only after a `next dev`/`build`/`typegen`, so bare `tsc --noEmit` fails on a
  fresh clone
- `npm run lint` — ESLint
- `npm test` — unit tests (vitest); fast and network-free
- `npm run eval:rag` — retrieval-quality eval against a real committed PDF and
  the live Sarvam API, kept out of `npm test` on purpose (`evals/README.md`)

No CI workflow is wired up yet (why: Known limitations in
`docs/ARCHITECTURE.md`), so run `npm run typecheck`, `npm run lint`, `npm test`
and `npm run build` locally before pushing.

## What works today

Document ingestion, hybrid BM25 + dense retrieval, cited answers (or an
honest refusal), cross-language querying, and chapter/concept extraction are
all live — see `/rag-demo`. The teaching loop — plan a lesson, teach it beat
by beat, ask checkpoint questions, evaluate an answer, re-explain differently
when it's wrong, then produce a report — runs behind `/api/teach/*`; see "The
teaching engine" in `docs/ARCHITECTURE.md` for the endpoints. Note that
`POST /api/teach/sessions` returns once the lesson is *planned* and scripts
the lesson in the background, so poll `GET /api/teach/sessions/:id` until its
`scriptingStatus` settles. Teaching-video generation (narration, subject-aware
visuals, the avatar, composition, encoding) is implemented in `lib/video/` —
see `docs/VIDEO.md`.

See `docs/ARCHITECTURE.md` and `docs/SCHEMA.md` for the system design and
database schema.
