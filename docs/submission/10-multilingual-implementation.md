# Multilingual implementation

## Supported languages

Eleven `LanguageCode` values (`lib/types.ts`, `lib/teach/profile.ts`):
English (`en-IN`), Hindi (`hi-IN`), Hinglish, Bengali (`bn-IN`), Tamil
(`ta-IN`), Telugu (`te-IN`), Marathi (`mr-IN`), Kannada (`kn-IN`), Gujarati
(`gu-IN`), Malayalam (`ml-IN`), Punjabi (`pa-IN`) — the exact set the spec's
own architecture note calls the minimum, and all eleven route through the
same code path (no per-language special-casing beyond the Hinglish handling
below).

`LANGUAGE_NAMES` maps each code to a written-out name because **a bare code
is not a reliable instruction to the model** — verified live, the model
sometimes wrote Hindi despite an explicit `en-IN` request when only the raw
code was given. `languageInstruction(code)` (`profile.ts`) turns
`"en-IN"` into `"Write in English (language code \"en-IN\").")`, and every
prompt in `lib/teach/` and `lib/rag/` routes through it rather than
interpolating the code directly.

**Hinglish is deliberately not a `/translate` target language code** — Sarvam
doesn't recognize it as one. It's handled as English text with an explicit
Hindi code-switching instruction to the chat model
(`LANGUAGE_NAMES.hinglish`: *"English text with natural Hindi code-switching,
Latin script"*), and mapped to `hi-IN` specifically for TTS
(`narrate.ts`'s `ttsTargetLanguageCode()`) so code-switched narration is
still pronounced naturally rather than rejected by the API.

## Choosing the teaching language

Two entry points, both real, both verified live:

1. **At profile/lesson-creation time** — either explicitly (`language` field
   on the session) or extracted from the free-text instruction by
   `parseTeachingInstruction()` (e.g. "teach me in Hindi" → `language:
   "hi-IN"` in the returned `TeachingIntent`, with no explicit field needed).
2. **Mid-lesson, by asking naturally** — `detectLanguageSwitch()`
   (`profile.ts`), called first inside `ask.ts`'s follow-up handler before
   any other interpretation of the learner's message.

## A real, live mid-lesson switch

Run against an active session teaching "Electricity: Ohm's Law" in English
(`en-IN`), via `POST /api/teach/sessions/:id/ask`:

> **Message:** *"ab hindi mein samjhao"*
>
> **Response:** *"Sure — switching to Hindi (Devanagari script) now."*

Server-side, in the same request: `detectLanguageSwitch()` returned
`"hi-IN"` (not null, so this was correctly recognised as a switch request
and not just a passing mention of a language), and
`updateLessonSessionLanguage()` wrote the session's `language` column to
`hi-IN` — confirmed by re-fetching the session immediately after:
`session.language` changed from `"en-IN"` to `"hi-IN"` in place.
`current_scene_order` was untouched, so the next scene the learner watches
continues from exactly where the lesson was, now narrated in Hindi.

## Material in one language, teaching in another — both directions

The spec asks for both an English textbook taught in Hindi and a Hindi
textbook taught in English. This system supports both, through the same
grounding path, not two separate code paths:

- **Retrieval**: `lib/rag/language.ts` translates the **query** into the
  document's detected language (detected once at index time from Unicode
  script ranges, stored on `documents.language`) before retrieval — not the
  corpus, which stays as uploaded. Verified live: real Devanagari Hindi
  ("विद्युत धारा क्या है?") retrieves correctly against English material.
- **Answering**: `sarvam-105b` reads the retrieved excerpts in their source
  language and writes the answer in whatever language the learner asked in
  or is being taught in — one chat call handles both the cross-language
  read and the write, rather than a separate translation pass.
- **Planning and scripting**: `plan.ts`'s prompt explicitly notes *"the
  source excerpts above may be in a different language than this; translate/
  teach across that gap, don't just copy their language"* — the model is
  told, not left to infer, that source language and output language are
  independent.

See [06 — RAG implementation](06-rag-implementation.md) for the retrieval
mechanics and the one known limitation this creates (transliterated Hinglish
queries with no English cognate).

## Where multilingual support does not reach

- **Learning-path step titles/summaries are not translated** (see
  [08](08-personalisation-approach.md)) — navigational metadata only; each
  step's actual lesson content is fully multilingual once generated.
- **Cross-language retrieval accuracy depends on real script**, not
  Latin-transliterated Hindi with no English cognate in the query — see
  [06](06-rag-implementation.md)'s Known limitations for the measured
  boundary of this.
- No claim of translation quality is made beyond what was verified live in
  this build; no benchmark or accuracy number is cited because none was
  measured.
