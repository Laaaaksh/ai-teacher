# AI/ML models used

## The constraint that shaped every choice below

The only AI credential available for this build is a `SARVAM_API_KEY`. No
Anthropic, OpenAI, ElevenLabs, HeyGen, D-ID key, and no local Ollama. Every
model listed here is either a Sarvam-hosted model reached over its API, or a
model that runs entirely locally with no key at all. Nothing in this system
depends on a credential the project does not hold — where a capability would
normally reach for a paid model this project has no key for (image
generation, an avatar-generation service, phoneme-level forced alignment),
that gap is built around and disclosed, never faked. See
[16 — Known limitations](16-known-limitations.md).

## Sarvam-hosted models

| Model | Used for | Where |
|---|---|---|
| `sarvam-105b` (chat completions) | Every structured reasoning step in the teaching loop: parsing free-text instructions, planning lesson concepts, scripting scenes, evaluating answers, naming misconceptions, generating adaptations, grounded/general-knowledge follow-up answers, quiz generation, report prose | `lib/sarvam/client.ts`, called through `lib/teach/llm.ts` from every `lib/teach/*` module |
| `bulbul:v3` (text-to-speech) | Narration audio for every scene of the generated teaching video, in the learner's chosen language, with a persona-fixed speaker voice | `lib/video/narrate.ts` |
| Sarvam translate | Cross-language retrieval query translation (a Hindi question against English material or vice versa) | `lib/rag/language.ts` |
| Sarvam speech-to-text | Spoken checkpoint answers | `app/api/speech/route.ts`, consumed by `CheckpointQuestion.tsx` |

`sarvam-105b` is a **reasoning model**: it writes `reasoning_content` before
`content`, and `max_tokens` covers both. This was measured live during
development, not assumed — a heavy structured prompt's reasoning alone ran
26,000–34,000 characters, so a call budgeted at the framework-typical 4,096–
8,000 tokens returned `finish_reason: "length"` with **content completely
empty**, three times out of four in one measured run. `reasoning_effort`,
`reasoning.effort`, `thinking: false` and `max_reasoning_tokens` were all
tested live against the same prompt and are silently ignored — one even
produced *more* reasoning than the baseline. The fix applied here
(`lib/sarvam/config.ts`): budget well clear of the reasoning cost
(`DEFAULT_MAX_TOKENS = 28,000`, `DEFAULT_TIMEOUT_MS = 90,000`, re-verified at
4/4 success, ~47s average), and ask for less per call by splitting large
structured asks into smaller independent ones fired in parallel
(`script.ts`'s `scriptConcept()` fires two calls via `Promise.all` instead of
one). This single measurement is the reason every `lib/teach` call is fast
and reliable rather than the multi-minute, often-failing design an
unbudgeted call would produce — see the full write-up in
`docs/ARCHITECTURE.md`'s "Real-behaviour fixes" section.

`bulbul:v3` speakers used by the built-in teacher personas
(`lib/video/avatar/personas.ts`): `priya`, `aditya`, `kavya` — three of the
ten `bulbul:v3` speakers this project verified live; v2 speakers such as
`anushka` are rejected by v3 and would surface as an HTTP error, so the
persona list is deliberately restricted to confirmed-working v3 speaker ids.

## Local, key-free models

| Model | Used for | Where |
|---|---|---|
| `Xenova/all-MiniLM-L6-v2` (ONNX, quantized, ~23MB) | 384-dimensional sentence embeddings for retrieval — Sarvam has no embeddings endpoint (404, verified live) | `lib/rag/embed.ts`, via `@xenova/transformers` |
| BM25 (hand-rolled, no dependency) | Lexical retrieval scoring, fused with dense similarity via Reciprocal Rank Fusion | `lib/rag/bm25.ts` |

MiniLM downloads once (network required for that one run) and caches under
`.cache/transformers/`; every run after that is fully offline for embedding.
It is English-tuned, which is why cross-language retrieval translates the
*query* rather than assuming the embedding model understands Hindi directly
— see [06 — RAG implementation](06-rag-implementation.md).

## Not used, and why

- **No image-generation model.** Labelled diagrams are a generic geometric
  schematic (blob/rect/circle + leader lines via inline SVG), not
  anatomically accurate artwork. An `image` visual renderer exists as a
  content contract in the types and rendering layer (`VisualSpec`,
  `lib/video/visuals/`), but no current code path in this branch reaches it:
  no entry in `SUBJECT_VISUAL_RULES` (`lib/teach/script.ts`) ever selects
  `renderer: "image"`, and no document parser (`lib/documents/`, including
  `parsePptx.ts`) extracts images from an upload. No imagery — uploaded or
  generated — appears in a rendered lesson today.
- **No forced-alignment / phoneme-timing model.** The avatar's lip-sync is an
  amplitude-bucketed viseme approximation driven by the TTS audio's RMS
  envelope, not true phoneme-level sync, because Sarvam TTS returns no
  alignment data to sync against and no credential exists for a dedicated
  alignment service.
- **No local LLM (Ollama or otherwise).** Confirmed not installed on the
  build machine; not a deliberate architectural exclusion, just not
  available, and `sarvam-105b` is capable enough for every structured call
  this system makes.
