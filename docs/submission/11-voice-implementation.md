# Voice implementation

Two directions: the teacher speaks (text-to-speech, into the generated
video), and the learner speaks (speech-to-text, answering a checkpoint by
voice). Both go through Sarvam AI; nothing here is a browser-native
`SpeechSynthesis`/`SpeechRecognition` fallback standing in for a real API.

## Text-to-speech: narration for every scene

`lib/video/narrate.ts`'s `narrate()` calls `POST /text-to-speech`
(`bulbul:v3`, via `lib/sarvam/client.ts`'s `textToSpeech()`) once per scene,
with the scene's narration text, the lesson's `LanguageCode`, and the active
teacher persona's fixed `speaker`. The response is `{"audios": ["<base64
wav>"]}`; the client decodes it to a `Buffer` and computes an amplitude
envelope from the raw samples (`lib/video/wav.ts`'s `decodeWav()` +
`extractEnvelope()`, sampled at 30fps) — this envelope is what drives the
avatar's lip-sync, described in
[12 — Avatar and video generation approach](12-avatar-video-generation.md).

- **Caching**: keyed by `sha256(text, language, speaker, pace)` under
  `data/video-cache/audio/` — editing one scene's narration only
  re-synthesizes that one scene, not the whole lesson.
- **Language routing**: `ttsTargetLanguageCode()` passes the lesson's
  language straight through as `target_language_code`, except `"hinglish"`,
  which Sarvam doesn't recognise as a code and is mapped to `"hi-IN"` so
  code-switched narration is pronounced naturally rather than rejected.
- **Speaker per persona, not per language**: a person's voice doesn't change
  with the language they're speaking, so `speaker` is fixed per teacher
  persona (`priya`, `aditya`, `kavya` — see
  [05](05-ai-ml-models.md#sarvam-hosted-models)) and only
  `target_language_code` varies with the lesson's language.
- **Verified live during this build**: `/api/health`'s TTS probe makes a
  real call and confirms the response decodes to a playable WAV; the actual
  Ohm's Law lesson video render exercised this for all 18 scenes of a real
  lesson (11 original beats + 2 adaptation beats + summary), producing real
  narration audio for the trace in
  [07 — Prompt and agent architecture](07-prompt-agent-architecture.md).

## Speech-to-text: answering by voice

`app/api/speech/route.ts` accepts a multipart `audio` field (max 10MB),
calls `speechToText()` (`POST /speech-to-text`, multipart, via
`lib/sarvam/client.ts`), and returns the transcript. `CheckpointQuestion.tsx`
records the learner's spoken answer in the browser and posts it here before
submitting the transcript through the normal `/answer` evaluation path — the
evaluator never knows whether an answer was typed or spoken, so voice
answers get the same misconception-naming, adaptation and difficulty
tracking as typed ones.

`sttLanguageCode()` passes the lesson's language as an STT hint, with the
same Hinglish handling as TTS: `"hinglish"` isn't a real STT language code,
and recorded Hinglish speech is phonetically mostly Hindi, so the route asks
Sarvam for `"hi-IN"` rather than omitting the hint entirely.

## Verifying reachability, not just wiring

`GET /api/health` makes a real STT call (a valid-but-silent WAV) alongside
real chat/TTS/translate calls, so the endpoint reports actual reachability
and authentication, not a hardcoded "ok" — verified live during this
session's setup (`/api/health` returned `reachable: true` for all four
services with real latencies before any other work began; see
[14 — Setup instructions](14-setup-instructions.md)).

## What voice does not cover

- **The final quiz is typed only.** `CheckpointQuestion.tsx`'s voice
  answering is wired into the lesson player's in-lesson checkpoints, not
  `Assessment.tsx`'s end-of-lesson quiz, since the two don't share a
  component — scoped out under time pressure, not a technical limitation.
  See [16 — Known limitations](16-known-limitations.md).
- **The health check's STT probe verifies reachability, not transcription
  accuracy** — a silent WAV can't measure how well real speech transcribes;
  a true accuracy check would need real recorded speech, which a health
  check can't manufacture, and no such benchmark is claimed here.
- **No word-level timing from Sarvam TTS** — captions are evenly paced
  across the measured audio duration (~8-word cues), not per-word timed; see
  [12 — Avatar and video generation approach](12-avatar-video-generation.md).
