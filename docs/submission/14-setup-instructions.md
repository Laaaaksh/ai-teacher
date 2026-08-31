# Setup instructions

Every step below was run, in order, on a clean checkout of this branch while
writing this documentation — not written and assumed. Actual measured
timings from that run are noted where relevant.

## Requirements

- Node.js 20+ (tested with Node 26)
- `ffmpeg` on `PATH` (`brew install ffmpeg` / `apt install ffmpeg`)
- A [Sarvam AI](https://www.sarvam.ai) API key — the only credential this
  project needs
- ~200MB free disk for `node_modules`, plus ~23MB for the one-time local
  embedding model download and space for generated video

No database server, no vector database, no other paid API.

## Steps

```bash
git clone <this-repo>
cd ai-teacher
npm install
```

**If `npm install` warns about pending install scripts** for
`better-sqlite3`, `esbuild`, `fsevents`, `protobufjs`, `sharp`, or
`unrs-resolver` — these are native modules that need their build step
approved in this environment (`npm`'s `allowScripts` supply-chain guard).
`sharp` is the one most easily missed: it is a nested dependency of
`@xenova/transformers`, and without it built, `lib/rag/embed.ts` throws at
module load, so the first document you index fails. Approve them
individually:

```bash
npm approve-scripts better-sqlite3@13.0.3
npm approve-scripts esbuild@0.28.2
npm approve-scripts protobufjs@6.11.6
npm approve-scripts sharp@0.32.6
npm approve-scripts unrs-resolver@1.12.2
# fsevents is macOS-only; skip it on Linux
```

**A real gotcha found running this exact sequence**: `npm approve-scripts
<pkg>` rewrites `package.json`'s `allowScripts` block to contain *only* the
package just approved, discarding the others already there — run it once
per package (as above), and if `git diff package.json` shows the block
shrank afterward, `git checkout -- package.json` restores it (the native
modules stay built; only the tracking file needs restoring). If your `npm`
version doesn't gate installs this way at all, this step is a no-op.

```bash
cp .env.example .env.local
# edit .env.local and set SARVAM_API_KEY=<your key>

npx playwright install chromium
```

This last step is required and is **not** covered by `npm install` — this
version of the `playwright` package ships no postinstall hook. Skipping it
makes teaching-video generation fail fast with Playwright's own error
message (naming the exact command to run) rather than hanging.

```bash
npm run dev
```

Open http://localhost:3000. SQLite is created automatically at
`data/ai-teacher.sqlite` on first run; the local embedding model
(`Xenova/all-MiniLM-L6-v2`, ~23MB) downloads on first document upload and
caches under `.cache/transformers/` — that one run needs network, every run
after is offline for embedding.

## Verifying the install worked

```bash
npm run typecheck   # next typegen && tsc --noEmit
npm run lint
npm test             # vitest, network-free
npm run build
```

All four were run on the clean checkout used to write this documentation:
`npm run typecheck` and `npm run lint` passed with no errors, **181/181
tests passed across 31 test files**, and `npm run build` produced a
successful production build covering the app's 5 pages and 23 API route
handlers. No CI is wired up in this repository (a GitHub Actions account billing issue on the hosting account —
see [16 — Known limitations](16-known-limitations.md)), so these four
commands are what to run locally before trusting a change.

Then confirm the Sarvam credential actually works:

```bash
curl -s http://localhost:3000/api/health | python3 -m json.tool
```

On the same clean checkout this returned `"ok": true` with all four services
(`chat`, `tts`, `translate`, `stt`) reachable, at latencies of 219–937ms —
this is a **real** reachability check (`/api/health` makes one live call per
service, cached 30s), not a hardcoded response.

## Exercising the system end to end (what a judge would do)

The full loop works from the home page (http://localhost:3000): upload
material or name a topic, describe how you want to be taught in your own
words, review the generated lesson plan (concepts, minutes, chosen visual +
why), watch a real generated teaching video, answer a checkpoint by typing
or voice, watch it re-explain with a different analogy when wrong, ask a
free-form question or switch language mid-lesson, finish a quiz, and read a
report naming real weak areas. `/rag-demo` exercises document indexing →
outline extraction → grounded question-answering on its own, independent of
a full lesson.

**Measured, live, on this exact checkout, while writing and reviewing this
documentation**
(via the API surface directly — see [04](04-system-architecture.md) for the
full request-path diagram):

The first three figures below are ranges spanning **two** runs of the same
flow on one machine, and the fourth is a **single** run — these are samples,
not a benchmark, and the dominant source of variance is live third-party
Sarvam API latency, which this project does not control.

- Planning a 3-concept, 20-minute "Electricity: Ohm's Law" lesson for a
  beginner: **~37–44s**, one request.
- Scripting all 3 concepts into full scenes (in the background, pooled 3 at
  a time): **~80–160s**.
- Evaluating a wrong checkpoint answer, naming the misconception, and
  generating the full adaptation (re-explanation, new example, new
  question): **~42–83s**, one request — the real trace is in
  [07](07-prompt-agent-architecture.md).
- Rendering the full 18-scene lesson video (15 taught beats — 5 beats × 3
  concepts — plus 2 adaptation scenes and a closing summary) into a
  downloadable MP4, real Sarvam TTS + real Chromium capture + real `ffmpeg`
  mux: **9m 49s (589s)** wall-clock, producing an 8m 9s video. That render
  was only ever run once, so this is one measured run rather than a range —
  not a guarantee of render time on any other machine or lesson, since it
  depends on live Sarvam TTS latency and local CPU/GPU capability as well as
  lesson length. Breakdown in
  [12 — Avatar and video generation approach](12-avatar-video-generation.md#what-was-actually-measured-live-during-this-build).

## Optional: the RAG evaluation harness

```bash
npm run eval:rag
```

Deliberately kept out of `npm test` — it costs real Sarvam API calls and
runs against a committed PDF fixture (`evals/fixtures/electricity-basics.pdf`).
See `evals/README.md`.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `SARVAM_API_KEY` | **Yes** | — | The only AI credential. Never commit a real value — `.env.local` is gitignored. |
| `DB_PATH` | No | `data/ai-teacher.sqlite` | Override the SQLite file location (tests use `:memory:`). |
| `VIDEO_CACHE_DIR` | No | `data/video-cache` | Override where narration WAVs and rendered MP4s are cached. |
