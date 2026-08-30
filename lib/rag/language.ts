import { translate } from "../sarvam";
import type { LanguageCode } from "../types";

/**
 * Cross-language retrieval decision (see docs/ARCHITECTURE.md "RAG" section):
 * all-MiniLM-L6-v2 is an English-tuned model, so a Hindi query embedded
 * directly against English chunks (or vice versa) scores close to random —
 * and BM25 has zero token overlap across scripts. Rather than embedding in
 * a shared multilingual space (would mean swapping the embedding model, a
 * bigger download with no verified local option here) or translating the
 * whole corpus at index time (translates text nobody may ever ask about,
 * and re-introduces translation error into every chunk instead of one
 * query), retrieval translates the QUERY into the document's dominant
 * language via Sarvam's real /translate endpoint before scoring. The
 * retrieved excerpts stay in the source language; sarvam-105b (the
 * generation model) reads them directly and writes the grounded answer in
 * whatever language the learner asked for — it is fluent enough across
 * Indic languages plus English to do that leap in one call, which is
 * simpler and more natural than machine-translating the excerpts too.
 */

/** Unicode script ranges used to guess a text's dominant language when no explicit code is known. */
const SCRIPT_RANGES: { code: LanguageCode; pattern: RegExp }[] = [
  { code: "hi-IN", pattern: /[ऀ-ॿ]/g }, // Devanagari (Hindi, and Marathi — indistinguishable by script alone; Hindi is the more common default)
  { code: "bn-IN", pattern: /[ঀ-৿]/g }, // Bengali
  { code: "ta-IN", pattern: /[஀-௿]/g }, // Tamil
  { code: "te-IN", pattern: /[ఀ-౿]/g }, // Telugu
  { code: "kn-IN", pattern: /[ಀ-೿]/g }, // Kannada
  { code: "ml-IN", pattern: /[ഀ-ൿ]/g }, // Malayalam
  { code: "gu-IN", pattern: /[઀-૿]/g }, // Gujarati
  { code: "pa-IN", pattern: /[਀-੿]/g }, // Gurmukhi (Punjabi)
];

/** Latin letters compete on the same footing as the Indic scripts above, so English text quoting one Devanagari term stays English. */
const LATIN_PATTERN = /[A-Za-z]/g;

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

/**
 * Best-effort language guess from the *dominant* Unicode script — the one
 * with the most characters, not merely the first one that appears, since a
 * single foreign term should not flip a whole document's language and so
 * its retrieval path (see translateQueryForRetrieval below). Falls back to
 * English for Latin-script text (including Hinglish, which is written in
 * Latin script with Hindi code-switching — treating it as English for
 * detection purposes is deliberate; see the LanguageCode doc comment in
 * lib/types.ts).
 */
export function detectLanguage(text: string): LanguageCode {
  let best: LanguageCode = "en-IN";
  let bestCount = countMatches(text, LATIN_PATTERN);

  for (const { code, pattern } of SCRIPT_RANGES) {
    const count = countMatches(text, pattern);
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }

  return best;
}

/** "hinglish" is not a /translate target/source code — treat it as English text (see lib/types.ts's LanguageCode doc comment). */
function toTranslateCode(lang: LanguageCode): "en-IN" | Exclude<LanguageCode, "hinglish"> {
  return lang === "hinglish" ? "en-IN" : lang;
}

/**
 * Translates `query` into `targetLanguage` when they differ, for matching
 * against a corpus written in `targetLanguage`. Returns the original query
 * unchanged when the languages already match (the common case, and it
 * avoids burning a Sarvam call on every retrieval).
 */
export async function translateQueryForRetrieval(query: string, queryLanguage: LanguageCode, targetLanguage: LanguageCode): Promise<string> {
  const source = toTranslateCode(queryLanguage);
  const target = toTranslateCode(targetLanguage);
  if (source === target) return query;

  const result = await translate({ input: query, sourceLanguageCode: source, targetLanguageCode: target });
  return result.translatedText;
}
