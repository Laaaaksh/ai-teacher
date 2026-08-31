# Teaching-video generation

Turns a `LessonPlan` + its `Scene[]` (persisted by the lesson-planner slice via
`lib/db`) into a downloadable MP4: real Sarvam narration, a subject-aware
visual per scene, and an animated 2D avatar presenting beside it — not a
talking head in front of generated text, and not a static slideshow (the
spec's two explicit failure modes; see `docs/ARCHITECTURE.md`).

No avatar API key exists (no HeyGen/D-ID/ElevenLabs), so the avatar is
rendered by this app: an SVG presenter animated in a real headless Chromium
page, captured frame by frame, muxed with narration audio via `ffmpeg`.

## Setup (beyond `SARVAM_API_KEY`)

This slice needs two things the rest of the app doesn't:

1. **A downloaded Chromium for Playwright.** `npm install` does **not**
   fetch it automatically (the `playwright` package ships no postinstall
   hook in this version). Run once:
   ```bash
   npx playwright install chromium
   ```
   (adds `--with-deps` on a bare Linux box to pull the system libraries
   Chromium needs). The browser is cached under `~/Library/Caches/ms-playwright`
   (macOS) / `~/.cache/ms-playwright` (Linux) and shared across projects, so
   this is usually a one-time cost per machine.
2. **`ffmpeg` on `PATH`.** Used as a subprocess (`lib/video/ffmpeg.ts`), not
   an npm dependency. `brew install ffmpeg` / `apt install ffmpeg`.

If either is missing, `renderLessonVideo()` fails fast with the tool's own
error message (Playwright's mentions the exact install command) rather than
hanging or producing a corrupt file.

## Pipeline

```
Scene[] ──narrate.ts──> per-scene WAV + amplitude envelope (cached by content hash)
        ──visuals/────> per-scene HTML panel (KaTeX/Shiki/Mermaid/plotter/SVG/HTML)
        ──compose.ts──> full HTML page: avatar + visual + captions + on-screen text
        ──render.ts───> Chromium screenshots one page per logical frame ──ffmpeg──> scene MP4
        ──render.ts───> ffmpeg concat (title card + scenes) ─────────────────────> lesson MP4
```

Everything server-side; the browser is only used as a rendering engine
(`page.setContent()`, no network fetches, no local HTTP server — KaTeX fonts
and the Mermaid bundle are inlined so a scene page is fully self-contained).

### Determinism

Every frame is a pure function of a logical timestamp `tMs`, set via
`page.evaluate(() => window.__renderFrame(tMs))` immediately before each
`page.screenshot()`. The CSS deliberately has **no `transition` or
`@keyframes`** — those run on wall-clock time inside the browser, which would
make two renders of the same scene diverge slightly frame-to-frame. Idle
avatar motion (blink timing, mouth-shape variant) uses a seeded
pseudo-random function of `(sceneSeed, timeBucket)`, not `Math.random()`, so
re-rendering an unchanged scene reuses the cache (see below) and, if forced
to re-render, produces visually identical output.

### Caching

- **Narration** (`lib/video/narrate.ts`): cached by `sha256(text, language,
  speaker, pace)` under `data/video-cache/audio/`. Editing one scene's
  narration only re-synthesizes that scene.
- **Per-scene video** (`lib/video/render.ts`): cached by `sha256(the fully
  composed scene page, fps, resolution, pipeline version)` under
  `data/video-cache/scenes/`. Keying on the composed page rather than on a
  chosen subset of its inputs means anything that reaches a captured frame —
  visual, narration, avatar envelope, captions, header text, scene numbering,
  persona — invalidates the entry automatically. Re-rendering a lesson after
  changing one scene's visual or narration only re-captures that scene;
  the final video is a fast `ffmpeg -c copy` concat of the (mostly cached)
  scene files. Bump `PIPELINE_VERSION` in `render.ts` if a rendering-logic
  change should invalidate every cached scene.

### Memory

The pipeline holds no whole-lesson buffer at any stage: one persistent
browser + one capture page (not one per scene), frames written straight to
disk and deleted right after each scene's `ffmpeg` encode (never held in
memory), and the final concat using `ffmpeg -c copy` (stream copy, no
re-encode, no buffering). The download route
(`app/api/video/[jobId]/download/route.ts`) streams the file from disk rather
than reading it into memory. Cost is therefore per scene, not per lesson.

**What was actually measured**: the ~80-second, three-scene demo lesson
(`scripts/demo-lesson.ts`). Server RSS stayed flat across it — roughly 75MB
down to 56MB, peaking around 73MB — with no per-scene accumulation. Longer
lessons, including a 20-minute one, are *expected* to hold at that level
because the design is per-scene, but no render of that duration has been
measured. Treat the 20-minute case as an unverified extrapolation, not a
tested claim.

## `VisualSpec.content` contract per renderer

`lib/types.ts` deliberately keeps `VisualSpec.content` a renderer-specific
string. Each renderer under `lib/video/visuals/` parses it defensively (falls
back to a placeholder rather than throwing on malformed input) so a planner
slice that hasn't matched this contract exactly still renders *something*.

| renderer | kind(s) | `content` format |
|---|---|---|
| `katex` | equation, step-by-step | JSON `string[]` (LaTeX per step), or `{ "steps": string[], "final"?: string }`, or a raw LaTeX string (single step) |
| `shiki` | code | `{ "language": "python", "code": "...", "output"?: "..." }`, or raw code (language "text") |
| `mermaid` | diagram, timeline, architecture-diagram | raw Mermaid source (unambiguous, no wrapping needed) |
| `plotter` | graph | `{ "fn": "x^2", "xMin": -5, "xMax": 5, "samples": 60 }` (evaluated with the safe expression parser in `visuals/expr.ts` — never `eval`/`Function`) and/or `{ "series": [{ "label": "...", "points": [[x,y], ...] }], "kind": "line"\|"bar"\|"scatter" }` |
| `svg` | labelled-diagram | `{ "title"?: "...", "shape"?: "blob"\|"rect"\|"circle"\|"none", "labels": [{ "text": "...", "x": 0-100, "y": 0-100 }] }` |
| `html` | bullets, comparison-table, concept-map | bullets: JSON `string[]` or newline-separated text. comparison-table: `{ "headers": string[], "rows": string[][] }` |
| `image` | image | a `data:image/...` or `http(s)://` URL — there is no image-generation credential, so this only ever displays material the lesson actually cites (e.g. an image lifted from a parsed slide) |

Progressive reveal (`lib/video/visuals/types.ts`'s `RevealMode`) is generic
across renderers, driven by `compose.ts`'s frame script, not per-renderer
code:
- `"steps"` — `.reveal-step[data-step]` elements appear one by one, evenly
  spaced across the scene's narrated duration (math steps, code→output,
  bullets, table rows, diagram labels). Under the other two modes any
  `.reveal-step` is simply shown from the first frame.
- `"continuous"` — an SVG path with `data-continuous-reveal` is drawn on
  (via `stroke-dasharray`/`-offset`) over the scene duration (plotted
  function/line graphs).
- `"fade"` — the whole visual fades/scales in once near the start of the
  scene (Mermaid diagrams, images) rather than being staggered piece by
  piece — Mermaid's internal SVG shape differs enough per diagram type that
  reliable node-by-node staggering isn't worth the fragility.

## Avatar

`lib/video/avatar/`: a flat 2D SVG bust (`avatarRuntime.ts`) with a
deterministic runtime (`window.__avatarStep(tMs)`) driving:
- **Mouth**: amplitude-bucketed viseme *approximation* — four mouth shapes
  selected from the narration's RMS amplitude envelope (`narrate.ts`
  extracts this from the decoded WAV). This is **not** true phoneme-level
  lip-sync; Sarvam TTS returns no forced-alignment/phoneme timing to sync
  against, so exact viseme-per-phoneme lip-sync is out of reach without an
  additional alignment step this project doesn't have a credential for.
- **Idle life**: seeded blink every ~2.5–6s, a slow head sway + bob (bigger
  while the amplitude is high, so it reads as "talking with energy" rather
  than motionless).
- **Emphasis gesture**: a brief hand-raise + eyebrow lift when amplitude
  sustains above a threshold, with a cooldown so it doesn't fire constantly.

**Personas** (`avatar/personas.ts`): each has one fixed Sarvam v3 speaker (a
person's voice doesn't change with the language they're speaking) and a
distinct palette/hairstyle. Swappable per lesson via `personaId` — satisfies
the "multiple teacher personalities" bonus feature. Add a new one by adding
an entry to `TEACHER_PERSONAS`; nothing else needs to change.

## Voice selection

`narrate.ts`'s `ttsTargetLanguageCode()` passes the lesson's `LanguageCode`
straight through to Sarvam's `target_language_code` — all of them are
already valid Sarvam codes except `"hinglish"`, which Sarvam doesn't
recognize (per `docs/ARCHITECTURE.md`) and is mapped to `"hi-IN"` so
code-switched narration is still pronounced naturally rather than rejected
by the API.

## Known limitations

- **Amplitude-driven viseme approximation, not phoneme-level lip-sync** (see
  Avatar above) — the honest ceiling without a forced-alignment credential.
- **No real illustrative art.** Labelled diagrams (`visuals/labelledDiagram.ts`)
  are a generic geometric schematic (blob/rect/circle + leader lines), not
  anatomically/scientifically accurate artwork — there is no image-generation
  credential. The `image` renderer only ever displays material actually
  supplied in `VisualSpec.content` (e.g. lifted from a parsed slide).
- **Mermaid diagrams reveal as a single entrance, not node-by-node** — see
  the `RevealMode` table above.
- **Single-process job queue** (`lib/video/jobs.ts`): a render job is an
  in-process `Promise` tracked in the `video_jobs` table, not a durable
  worker queue. Fine for one local `next dev`/`next start` instance; a
  process restart mid-render leaves that job stuck at its last-written
  progress (not silently "completed"), and it does not scale to multiple
  app instances/serverless without a real queue.
- **Even-paced captions**, not per-word timing — Sarvam TTS returns no word
  timestamps, so `captions.ts` splits narration into ~8-word cues spaced
  evenly across the measured audio duration.
- **24fps default** (`DEFAULT_FPS` in `render.ts`) — a deliberate
  time/quality tradeoff for a long lesson's frame count; raise it
  per-request via `fps` if a demo needs smoother motion and render time is
  not a constraint.
- **Only short lessons have been rendered** — the longest measured run is the
  ~80-second demo lesson; see [Memory](#memory) for what that measured and
  what remains extrapolation.

## Manually verifying a render

`scripts/demo-lesson.ts` seeds a real mixed-subject lesson plan (three scenes:
a step-by-step quadratic-formula derivation, a Python code example with its
output, and a Mermaid history timeline) directly via `lib/db`, then calls
`renderLessonVideo()` for real — real Sarvam TTS, real Chromium capture, real
`ffmpeg` mux:

```bash
npx tsx scripts/demo-lesson.ts
# -> data/generated/demo-lesson.mp4  (gitignored build output)
```

This is not part of `npm test` (it costs real TTS calls and real render
time); it is how this slice was actually watched end to end before being
called done.

## API

- `POST /api/video` `{ lessonPlanId, personaId? }` → `202 { jobId, status }`.
  Starts a render in-process (see the job-queue limitation above) against an
  existing lesson plan (created by the lesson-planner slice).
- `GET /api/video/:jobId` → live `{ status, progressPercent, stageDetail,
  errorMessage, downloadUrl }`, written by the pipeline itself as it
  narrates/renders/muxes each scene — not a fake spinner. `downloadUrl` is
  `null` until `status === "completed"`; `errorMessage` carries the real
  failure text when `status === "failed"`.
- `GET /api/video/:jobId/download` → streams the MP4 once `status ===
  "completed"`.
