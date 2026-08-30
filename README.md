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
npm run dev
```

Requires Node 20+. No database server, vector DB, or other paid API is needed —
SQLite lives on disk at `data/ai-teacher.sqlite` and is created automatically on
first run.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run typecheck` — `next typegen && tsc --noEmit`; typegen must run first
  because Next 15 emits the typed-routes globals (`LayoutProps`, `PageProps`)
  only after a `next dev`/`build`/`typegen`, so bare `tsc --noEmit` fails on a
  fresh clone
- `npm run lint` — ESLint
- `npm test` — unit tests (vitest)

No CI workflow is wired up yet (why: Known limitations in
`docs/ARCHITECTURE.md`), so run `npm run typecheck`, `npm run lint`, `npm test`
and `npm run build` locally before pushing.

## What works today

The web page covers the learner profile and uploading material (or naming a
topic). The teaching loop itself — plan a lesson, teach it beat by beat, ask
checkpoint questions, evaluate an answer, re-explain differently when it's
wrong, then produce a report — runs behind `/api/teach/*` and is drivable end
to end from there; see "The teaching engine" in `docs/ARCHITECTURE.md` for the
endpoints. Note that `POST /api/teach/sessions` returns once the lesson is
*planned* and scripts the lesson in the background, so poll
`GET /api/teach/sessions/:id` until its `scriptingStatus` settles.

Still to come, as separate slices: the lesson player / video UI, and RAG
retrieval (embeddings + BM25 fusion — follow-ups are grounded by a local
lexical scorer until then).

See `docs/ARCHITECTURE.md` and `docs/SCHEMA.md` for the system design and
database schema.
