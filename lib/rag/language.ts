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
  { code: "hi-IN", pattern: /[ऀ-ॿ]/ }, // Devanagari (Hindi, and Marathi — indistinguishable by script alone; Hindi is the more common default)
  { code: "bn-IN", pattern: /[ঀ-৿]/ }, // Bengali
  { code: "ta-IN", pattern: /[஀-௿]/ }, // Tamil
  { code: "te-IN", pattern: /[ఀ-౿]/ }, // Telugu
  { code: "kn-IN", pattern: /[ಀ-೿]/ }, // Kannada
  { code: "ml-IN", pattern: /[ഀ-ൿ]/ }, // Malayalam
  { code: "gu-IN", pattern: /[઀-૿]/ }, // Gujarati
  { code: "pa-IN", pattern: /[਀-੿]/ }, // Gurmukhi (Punjabi)
];

/**
 * Best-effort language guess from Unicode script, falling back to English
 * for Latin-script text (including Hinglish, which is written in Latin
 * script with Hindi code-switching — treating it as English for detection
 * purposes is deliberate; see the LanguageCode doc comment in lib/types.ts).
 */
export function detectLanguage(text: string): LanguageCode {
  for (const { code, pattern } of SCRIPT_RANGES) {
    if (pattern.test(text)) return code;
  }
  return "en-IN";
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
