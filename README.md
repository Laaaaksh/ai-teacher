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
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint
- `npm test` — unit tests (vitest)

See `docs/ARCHITECTURE.md` and `docs/SCHEMA.md` for the system design and database
schema. This repository is built up in slices; this foundation slice provides the
app scaffold, the Sarvam client, document ingestion, persistence and shared types
that later slices (lesson planning, the lesson player, video generation) build on.
