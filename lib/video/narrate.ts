import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { textToSpeech } from "../sarvam";
import type { SarvamSpeaker } from "../sarvam/types";
import type { LanguageCode } from "../types";
import { audioCacheDir } from "./paths";
import { decodeWav, extractEnvelope } from "./wav";

/** Frame rate the amplitude envelope is sampled at; render.ts interpolates this onto the actual video fps, so the two don't need to match. */
export const ENVELOPE_FPS = 30;

/**
 * bulbul:v3 target_language_code — "hinglish" is deliberately not a Sarvam
 * language code (docs/ARCHITECTURE.md): it is English text with Hindi
 * code-switching, read here with the Hindi target so mixed-script narration
 * is pronounced naturally rather than rejected by the API.
 */
export function ttsTargetLanguageCode(language: LanguageCode): string {
  return language === "hinglish" ? "hi-IN" : language;
}

export interface NarrationResult {
  /** Path to the cached WAV file on disk. */
  wavPath: string;
  audio: Buffer;
  durationSeconds: number;
  /** Amplitude envelope at ENVELOPE_FPS, normalized to [0, 1]. */
  envelope: number[];
}

interface NarrateParams {
  text: string;
  language: LanguageCode;
  speaker: SarvamSpeaker;
  pace?: number;
}

function cacheKey(params: NarrateParams): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify({ text: params.text, language: params.language, speaker: params.speaker, pace: params.pace ?? 1, model: "bulbul:v3" }));
  return hash.digest("hex");
}

/**
 * Scene narration -> Sarvam TTS -> cached WAV + amplitude envelope. Cached
 * by a content hash of (text, language, speaker, pace) so re-rendering a
 * lesson after editing one scene's narration only re-synthesizes that scene.
 */
export async function narrate(params: NarrateParams): Promise<NarrationResult> {
  const key = cacheKey(params);
  const wavPath = path.join(audioCacheDir(), `${key}.wav`);
  const envelopePath = path.join(audioCacheDir(), `${key}.envelope.json`);

  if (fs.existsSync(wavPath) && fs.existsSync(envelopePath)) {
    const audio = fs.readFileSync(wavPath);
    const meta = JSON.parse(fs.readFileSync(envelopePath, "utf8")) as { durationSeconds: number; envelope: number[] };
    return { wavPath, audio, durationSeconds: meta.durationSeconds, envelope: meta.envelope };
  }

  const { audio } = await textToSpeech({
    text: params.text,
    speaker: params.speaker,
    languageCode: ttsTargetLanguageCode(params.language),
    pace: params.pace,
  });

  const decoded = decodeWav(audio);
  const envelope = extractEnvelope(decoded, ENVELOPE_FPS);

  fs.writeFileSync(wavPath, audio);
  fs.writeFileSync(envelopePath, JSON.stringify({ durationSeconds: decoded.durationSeconds, envelope }));

  return { wavPath, audio, durationSeconds: decoded.durationSeconds, envelope };
}
