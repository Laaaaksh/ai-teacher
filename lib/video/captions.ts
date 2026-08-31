export interface CaptionCue {
  text: string;
  startMs: number;
  endMs: number;
}

const WORDS_PER_CUE = 8;

/**
 * Splits narration into caption cues timed evenly across the narrated audio
 * duration (there is no forced-alignment/word-timing from Sarvam TTS, so
 * this is a even-pacing approximation, not per-word timing — good enough
 * for on-screen captions, which are also the accessibility win the spec
 * calls out).
 */
export function buildCaptionCues(narration: string, durationSeconds: number): CaptionCue[] {
  const words = narration.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += WORDS_PER_CUE) {
    chunks.push(words.slice(i, i + WORDS_PER_CUE).join(" "));
  }

  const msPerChunk = (durationSeconds * 1000) / chunks.length;
  return chunks.map((text, i) => ({
    text,
    startMs: Math.round(i * msPerChunk),
    endMs: Math.round((i + 1) * msPerChunk),
  }));
}
