# Deployment instructions

## Recommended: a single persistent process (this is what the architecture is built for)

The app is a normal Next.js 15 application with two hard requirements
serverless/edge platforms typically don't provide: **a persistent
filesystem** (SQLite, uploaded documents, generated video, the cached
embedding model all live on local disk under `data/` and `.cache/`) and **a
long-lived Node process** (background lesson scripting and video rendering
are in-process work that must survive after an HTTP response is sent — see
[16 — Known limitations](16-known-limitations.md)).

```bash
npm install
npm run build
npm start
```

This works on any VM, container, or platform that gives you a persistent
disk and a process that stays alive between requests — a plain EC2/Droplet/
VPS instance, a long-running container (not a scale-to-zero one), or a
platform like Railway/Render/Fly.io configured as a persistent web service
rather than a serverless function. Alongside `SARVAM_API_KEY`, the deployment
target needs:

- `ffmpeg` on `PATH` (install at the OS/image level — `apt install ffmpeg`
  on a Debian-based image)
- `npx playwright install chromium --with-deps` (the `--with-deps` flag
  pulls the system libraries Chromium needs on a bare Linux box — not
  needed on macOS, which already has them)
- A writable, persistent volume mounted at the app's working directory (or
  set `DB_PATH`/`VIDEO_CACHE_DIR` to point at one) so `data/` and
  `.cache/transformers/` survive a redeploy — losing them loses the SQLite
  database, all uploaded documents, and forces the embedding model to
  re-download on next use

## Containerizing (Docker)

No `Dockerfile` ships in this repository. A minimal one would need: a
`node:20-slim`-or-later base, `ffmpeg` installed via the package manager,
`npx playwright install --with-deps chromium` run at build time (Chromium
itself is large — expect the image to grow by a few hundred MB), the app
built with `npm run build`, and a volume mounted for `data/` at runtime. This
is a reasonable next step but was not built or tested as part of this
submission — stated here rather than implied to exist.

## What will not work as deployed

- **Serverless/edge functions** (Vercel's default serverless runtime, AWS
  Lambda, Cloudflare Workers): background lesson scripting relies on the
  Node process staying alive after the HTTP response is sent, which
  serverless platforms explicitly do not guarantee — a function can be
  frozen or torn down mid-scripting. SQLite also assumes a persistent local
  disk, which serverless platforms don't provide across invocations.
  Deploying this way would need a real job queue (Redis/a worker service)
  and a real database (Postgres or similar) — a genuine architecture change,
  not a config flag, and explicitly out of scope for this submission (see
  [16 — Known limitations](16-known-limitations.md)).
- **Multi-instance/horizontally-scaled deployment**: the video render job
  tracker (`video_jobs`) and background scripting are in-process state, not
  shared across instances — a request routed to a different instance than
  the one running its job would see stale progress. Fine for the
  single-process demo this was built as; would need the same real job queue
  as above for more than one instance.

## What was actually deployed for this submission

No hosted deployment exists for this submission — there is no live URL to
visit. The working prototype is a local run: `npm run dev` (or `npm run
build && npm start`) on the reviewer's own machine, following
[14 — Setup instructions](14-setup-instructions.md). Every trace, screenshot,
and timing figure in this documentation was captured from exactly that local
run, on a clean checkout, against the real Sarvam API — not from a hosted
instance.
