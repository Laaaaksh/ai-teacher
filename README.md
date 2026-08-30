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
`data/ai-teacher.sqlite` and is created automatically on first run. See
`docs/VIDEO.md` for why the video-generation slice needs Playwright's browser
downloaded separately from `npm install`.

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

See `docs/ARCHITECTURE.md` and `docs/SCHEMA.md` for the system design and database
schema, and `docs/VIDEO.md` for the teaching-video generation pipeline
(narration, subject-aware visuals, the avatar, composition, encoding). This
repository is built up in slices; the foundation slice provides the app
scaffold, the Sarvam client, document ingestion, persistence and shared types
that other slices (lesson planning, the lesson player, video generation) build on.
