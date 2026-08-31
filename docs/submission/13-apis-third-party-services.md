# APIs and third-party services

Full disclosure of every significant external API, model, and library this
project depends on, per the assessment's requirement to "clearly disclose
significant third-party APIs, models, libraries, and services used."

## External API: Sarvam AI (the only paid/hosted service)

| Endpoint | Purpose | Client |
|---|---|---|
| `POST https://api.sarvam.ai/v1/chat/completions` (`sarvam-105b`) | Every reasoning step in the teaching loop | `lib/sarvam/client.ts` |
| `POST https://api.sarvam.ai/text-to-speech` (`bulbul:v3`) | Narration audio for the generated video | `lib/sarvam/client.ts` |
| `POST https://api.sarvam.ai/translate` | Cross-language retrieval query translation | `lib/sarvam/client.ts` |
| `POST https://api.sarvam.ai/speech-to-text` | Spoken checkpoint answers | `lib/sarvam/client.ts` |

Auth: `api-subscription-key: <SARVAM_API_KEY>` header on every call. This is
the **only** external AI service this project calls — no OpenAI, Anthropic,
ElevenLabs, HeyGen, D-ID, or any other paid API. See
[05 — AI/ML models used](05-ai-ml-models.md) for the models themselves and
the reasoning-token-budget behaviour that had to be worked around.

## Local, key-free AI computation

| Component | Purpose |
|---|---|
| `@xenova/transformers` (`Xenova/all-MiniLM-L6-v2`, ONNX) | Local sentence embeddings for retrieval — Sarvam has no embeddings endpoint |
| Hand-rolled BM25 (`lib/rag/bm25.ts`, no dependency) | Lexical retrieval scoring |

## System dependencies (not npm packages)

| Tool | Purpose | Why it's not bundled |
|---|---|---|
| `ffmpeg` | Muxes per-scene frames + audio into MP4, concatenates scenes into the final lesson video | Invoked as a subprocess (`lib/video/ffmpeg.ts`); must be on `PATH` |
| Playwright's Chromium | Headless rendering engine that captures each video frame | `npm install` does not fetch it (no postinstall hook in this Playwright version); needs `npx playwright install chromium` once per machine |

## Significant npm libraries

| Library | Purpose |
|---|---|
| `next` (15.x, App Router) | Application framework — pinned to 15 deliberately, not the `next@latest` (16.x) `create-next-app` installs by default |
| `react` / `react-dom` (19.x) | UI |
| `better-sqlite3` | Synchronous SQLite driver — the only datastore this app uses |
| `zod` | Runtime schema validation for every structured LLM response and every API request body |
| `@xenova/transformers` | Local embedding inference (see above) |
| `katex` | Client- and server-side LaTeX rendering (mathematics visuals) |
| `mermaid` | Diagram rendering (physics/chemistry/biology/history/programming/general visuals) |
| `shiki` | Syntax-highlighted code rendering (programming visuals) |
| `playwright` | Headless Chromium automation for frame capture |
| `pdf-parse`, `mammoth`, `jszip`, `fast-xml-parser`, `cheerio` | Document parsing: PDF, DOCX, PPTX (a zipped XML bundle), and their internal markup |
| `tailwindcss` v4 | Styling |
| `vitest` | Test runner (163 tests, network-free — see [14](14-setup-instructions.md)) |

Full list with exact pinned versions: `package.json`. `AGENTS.md`'s
"Non-obvious setup facts" section documents every dependency-related gotcha
this build actually hit (native-module install-script approval, Next's
`serverExternalPackages` list, the Playwright/`ffmpeg` setup steps) — see
[14 — Setup instructions](14-setup-instructions.md), which follows that
document's own guidance verified against a clean checkout.

## Explicitly not used

No vector database (SQLite stores embeddings as BLOBs; retrieval scores them
in-process), no external job queue or worker service (background scripting
and video rendering are in-process, disclosed as a limitation in
[16](16-known-limitations.md)), no cloud storage (uploads and generated video
live on local disk under `data/`, gitignored), no analytics or telemetry
service, no authentication provider (this is a single-learner-per-browser
demo, identified by a profile id in `localStorage`).
