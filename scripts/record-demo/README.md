# Submission demo recorder

Drives the real, running AI Teacher app through the assessment's own scenario —
upload a chapter, "Teach me Chapter 4 in 20 minutes, in Hindi, ask me questions
and test me at the end" — with Playwright, recording the real interaction and
downloading the app's own real generated teaching-video clips (with real
Sarvam narration audio) to splice in. Nothing is mocked: real Sarvam API,
real Chromium video rendering, real evaluation of real submitted answers.

## Running it

```bash
npm run build && npm run start   # production, not `next dev` — see "Why production, not dev" below
npx tsx scripts/record-demo/record.ts
```

Needs a clean slate for a real cold run: `data/ai-teacher.sqlite` deleted and
`data/uploads/` emptied *together* — clearing only one leaves the app working
off half-stale state (see "Known limitations" below) — and `SARVAM_API_KEY`
set in the environment. Output lands in `scripts/record-demo/output/`
(gitignored): the raw Playwright recording, the downloaded real
teaching-video clips, and `timeline.json`/`video-manifest.json` describing
what happened when.

Then assemble the final cut:

```bash
npx tsx scripts/record-demo/postprocess.ts
npx tsx scripts/record-demo/make-gif.ts <startSeconds> [durationSeconds]
```

`postprocess.ts` replaces long real dead-air waits (LLM planning, TTS/render
jobs) with a short labelled "cut" card — never sped up, always says how long
the real wait was — and splices the real generated teaching-video clips in
at full length with their real audio. `make-gif.ts` cuts a short GIF from the
finished `docs/assets/demo.mp4` (pass the adaptation moment's start time).

### Why production, not dev

`npm run dev` runs React in StrictMode, which double-invokes the effect that
starts a teaching-video render — this was measured creating two full render
jobs (two real Sarvam TTS+Chromium+ffmpeg runs) for the same scene batch,
silently doubling cost. `npm run start` against a `npm run build` output
doesn't.

### If your `ffmpeg` lacks `drawtext` or a codec

`postprocess.ts` and `make-gif.ts` read `FFMPEG_BIN`/`FFPROBE_BIN` from the
environment (default: `ffmpeg`/`ffprobe` on `PATH`). On this machine the
default Homebrew `ffmpeg` formula's build doesn't include `libfreetype`
(no `drawtext`), and separately broke entirely partway through this work
(`brew install ffmpeg-full`, needed for `drawtext`, upgraded the shared
`x265` dependency out from under the already-built `ffmpeg` bottle, which
still looked for the old `.dylib` version — a real, self-inflicted
side effect of installing `ffmpeg-full`, and worth knowing about if another
worktree/session on the same machine hits a mysteriously broken `ffmpeg`).
`ffmpeg-full` (`brew install ffmpeg-full`, keg-only, doesn't touch the
default `ffmpeg` symlink) has `drawtext` and was unaffected:

```bash
FFMPEG_BIN=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg \
FFPROBE_BIN=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe \
npx tsx scripts/record-demo/postprocess.ts
```

`CAPTION_FONT_FILE` similarly overrides the font used for cut-card captions
(default: macOS's Devanagari Sangam MN, which covers Latin and Devanagari in
one face — captions mix English with the lesson's own language). A caption
font that doesn't cover the lesson's script renders tofu boxes, not an error.

## Known rough edges in the committed `docs/assets/demo.mp4`

Written honestly, not smoothed over — this is the take that shipped, not a
retouched one.

- **Real per-concept teaching-video clips are excerpted, not played in
  full.** A full 20-minute-lesson plan's 3 real generated segments run
  1.5–2 real minutes each — playing all of them end to end, even with every
  dead LLM/render wait already cut down to a labelled card, ran ~8.6
  minutes, over the assessment's recommended 3–7. `postprocess.ts`'s
  `encodeRealClip` now caps how much of each real clip plays (35s for the
  adaptation re-explanation — the highest-weighted moment in the rubric —
  20s for the others), captioned "Excerpt — full clip runs Ns, not sped up"
  whenever it trims. Every clip is still 100% real footage of the real
  generated video, at real speed, for every stage; it's just not the whole
  thing. Final runtime: ~3m50s.
- **Two scenes had KaTeX render failures (raw LaTeX markup dumped into the
  frame, in red) that this take avoids only because they fall outside the
  excerpted window each clip plays** — not because they were fixed. Found by
  sampling frames across all 5 real clips end to end (not just the excerpted
  portions) after this exact defect was reported. See `docs/VIDEO.md`'s
  Known limitations for the root cause (`throwOnError: false` in
  `visuals/katex.ts`, no fallback the way Mermaid has one) and the two exact
  failures hit (a `\begin{array}` comparison table `visuals/katex.ts` can't
  parse, and a step with doubled backslashes from what looks like an
  escaping bug upstream of the renderer). Filed as a known limitation, not
  silently dropped, since the underlying bug is real and unfixed — it would
  surface again on a longer excerpt, a re-roll of the same lesson, or a
  different topic that reaches for a comparison table.
- **The quiz doesn't finish in this take, so there's no results/report or
  progress-dashboard segment.** The recorder reused the checkpoint's
  per-question "Submit answer" button selector for the final quiz — but the
  quiz has one shared "Submit quiz" button below all three questions, not one
  per question — so the second quiz question's fill hung for the automation's
  30s timeout, the process exited, and the recording ends on the
  partially-filled quiz screen (trimmed to stop there rather than padding out
  the ~60s of frozen dead air that followed the crash). **Fixed** in
  `record.ts` (`fillAnswer` vs. `submitAnswer` — quiz cards now fill-only,
  quiz submission is a single click after the loop) but not re-recorded,
  per instruction: this take ships with the gap, not a redo.
- **The automation's first quiz answer was wrong.** `pickAnswer`'s MCQ logic
  only recognizes "increase"/"decrease"/"inversely proportional" wording; a
  plain numeric Ohm's-law question ("12V, 4Ω, what's the current?") has none
  of that, so it fell back to picking the first option, which happened to be
  wrong (1A instead of 3A). Not visible in the shipped video (the quiz never
  got submitted), but a real gap in the recorder's answer-picking heuristics
  worth fixing before relying on quiz auto-answering for a future take.
- **All three concepts in this particular real lesson plan got a
  "concept-map" (Mermaid) visual.** That's the planner's own real decision
  each time — not scripted or faked — but it means this specific take doesn't
  show the KaTeX/Shiki/plotter renderers in action, even though the pipeline
  supports them (see `docs/VIDEO.md`); a different topic or a re-roll of the
  same one would likely pick differently.
- **A couple of "server unreachable, waiting to recover" recoveries were
  needed during real runs on this machine** (something else on the shared
  box killing `next dev`/`next start` mid-request) — `record.ts` now retries
  the triggering click once the server comes back rather than failing the
  whole take, and one such recovery is visible early in the shipped
  recording (the document-outline step).
- **Cut-card captions can visually sit over a button at the bottom of the
  underlying app screen** in a couple of spots — still fully readable, just
  not perfectly composed.

## Known limitation this surfaced in the app itself

Not a recorder bug: a DB reset that wasn't paired with clearing
`data/uploads/` happened once during this work, and outline extraction
dead-ended on the missing original file. `app/api/documents/[id]/outline`
now falls back to reconstructing the document from its already-indexed
chunks instead — see docs/ARCHITECTURE.md's Known limitations for what that
fallback does and does not preserve.
