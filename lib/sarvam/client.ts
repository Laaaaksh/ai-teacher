import type { z } from "zod";
import { SarvamError } from "./errors";
import { CHAT_MODEL, DEFAULT_MAX_TOKENS, SARVAM_BASE_URL, TTS_MODEL } from "./config";
import { sarvamPost } from "./http";
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatMessage,
  HealthCheckResult,
  SpeechToTextRequest,
  SpeechToTextResult,
  TextToSpeechRequest,
  TextToSpeechResult,
  TranslateRequest,
  TranslateResult,
} from "./types";

// ---------------------------------------------------------------------------
// Chat completions (sarvam-105b)
// ---------------------------------------------------------------------------

interface RawChatChoice {
  message?: { content?: string | null; reasoning_content?: string | null };
  finish_reason?: string;
}
interface RawChatResponse {
  choices?: RawChatChoice[];
}

export async function chat(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
  const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;

  const raw = await sarvamPost<RawChatResponse>({
    path: `${SARVAM_BASE_URL}/v1/chat/completions`,
    body: {
      model: CHAT_MODEL,
      messages: req.messages,
      max_tokens: maxTokens,
      temperature: req.temperature ?? 0.7,
      ...(req.responseFormat ? { response_format: req.responseFormat } : {}),
    },
  });

  const choice = raw.choices?.[0];
  const finishReason = choice?.finish_reason ?? "unknown";
  const content = choice?.message?.content ?? undefined;
  const reasoningContent = choice?.message?.reasoning_content ?? undefined;

  if (finishReason === "length" && !content) {
    throw new SarvamError(
      "truncated",
      `sarvam-105b hit max_tokens (${maxTokens}) before producing content — it was still writing reasoning_content. Increase maxTokens.`,
    );
  }

  if (!content) {
    throw new SarvamError("empty-content", `sarvam-105b returned no content (finish_reason: ${finishReason}).`);
  }

  return { content, reasoningContent, finishReason, raw };
}

// ---------------------------------------------------------------------------
// json<T>() — structured output validated with zod, one retry on malformed JSON
// ---------------------------------------------------------------------------

function extractJsonBlock(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

export interface JsonRequest {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

/**
 * Asks sarvam-105b for structured JSON output and validates it with the
 * given zod schema. On malformed JSON or a schema mismatch, retries once
 * with the parse error fed back to the model so it can correct itself; a
 * second failure surfaces as a typed SarvamError rather than an exception
 * from JSON.parse or a silently-wrong shape.
 */
export async function json<T>(schema: z.ZodType<T>, req: JsonRequest): Promise<T> {
  const attempt = async (messages: ChatMessage[]): Promise<{ value?: T; error?: string; rawContent: string }> => {
    const result = await chat({
      messages,
      maxTokens: req.maxTokens,
      temperature: req.temperature ?? 0.2,
      responseFormat: { type: "json_object" },
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonBlock(result.content));
    } catch (err) {
      return { error: `Invalid JSON: ${(err as Error).message}`, rawContent: result.content };
    }

    const validated = schema.safeParse(parsed);
    if (!validated.success) {
      return { error: `Schema validation failed: ${validated.error.message}`, rawContent: result.content };
    }
    return { value: validated.data, rawContent: result.content };
  };

  const first = await attempt(req.messages);
  if (first.value !== undefined) return first.value;

  const repairMessages: ChatMessage[] = [
    ...req.messages,
    { role: "assistant", content: first.rawContent },
    {
      role: "user",
      content: `That response was not valid JSON matching the required schema. Error: ${first.error}. Reply again with ONLY the corrected JSON object, no commentary, no markdown fences.`,
    },
  ];

  const second = await attempt(repairMessages);
  if (second.value !== undefined) return second.value;

  throw new SarvamError("invalid-json", `sarvam-105b returned malformed/invalid JSON after one repair attempt: ${second.error}`);
}

// ---------------------------------------------------------------------------
// Text-to-speech (bulbul:v3)
// ---------------------------------------------------------------------------

interface RawTtsResponse {
  audios?: string[];
}

export async function textToSpeech(req: TextToSpeechRequest): Promise<TextToSpeechResult> {
  const raw = await sarvamPost<RawTtsResponse>({
    path: `${SARVAM_BASE_URL}/text-to-speech`,
    body: {
      text: req.text,
      model: TTS_MODEL,
      ...(req.speaker ? { speaker: req.speaker } : {}),
      ...(req.languageCode ? { target_language_code: req.languageCode } : {}),
      ...(req.pace ? { pace: req.pace } : {}),
    },
  });

  const audioBase64 = raw.audios?.[0];
  if (!audioBase64) {
    throw new SarvamError("empty-content", "Sarvam TTS returned no audio.");
  }

  return { audio: Buffer.from(audioBase64, "base64"), raw };
}

// ---------------------------------------------------------------------------
// Translate
// ---------------------------------------------------------------------------

interface RawTranslateResponse {
  translated_text?: string;
}

export async function translate(req: TranslateRequest): Promise<TranslateResult> {
  const raw = await sarvamPost<RawTranslateResponse>({
    path: `${SARVAM_BASE_URL}/translate`,
    body: {
      input: req.input,
      source_language_code: req.sourceLanguageCode,
      target_language_code: req.targetLanguageCode,
    },
  });

  const translatedText = raw.translated_text;
  if (!translatedText) {
    throw new SarvamError("empty-content", "Sarvam translate returned no translated_text.");
  }

  return { translatedText, raw };
}

// ---------------------------------------------------------------------------
// Speech-to-text
// ---------------------------------------------------------------------------

interface RawSttResponse {
  transcript?: string;
}

export async function speechToText(req: SpeechToTextRequest): Promise<SpeechToTextResult> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(req.audio)]), req.filename ?? "audio.wav");
  if (req.languageCode) form.append("language_code", req.languageCode);

  const raw = await sarvamPost<RawSttResponse>({
    path: `${SARVAM_BASE_URL}/speech-to-text`,
    body: form,
  });

  const transcript = raw.transcript;
  if (transcript === undefined) {
    throw new SarvamError("empty-content", "Sarvam STT returned no transcript.");
  }

  return { transcript, raw };
}

// ---------------------------------------------------------------------------
// Health check — real reachability of each endpoint
// ---------------------------------------------------------------------------

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> {
  const start = Date.now();
  try {
    await fn();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    const message = err instanceof SarvamError ? `${err.kind}: ${err.message}` : (err as Error).message;
    return { ok: false, error: message };
  }
}

export async function checkHealth(): Promise<HealthCheckResult[]> {
  const [chatResult, ttsResult, translateResult] = await Promise.all([
    timed(() =>
      chat({
        messages: [{ role: "user", content: "Reply with the single word: ok" }],
        maxTokens: 200,
        temperature: 0,
      }),
    ),
    timed(() => textToSpeech({ text: "Health check.", speaker: "aditya" })),
    timed(() => translate({ input: "Hello", sourceLanguageCode: "en-IN", targetLanguageCode: "hi-IN" })),
  ]);

  // STT needs an audio payload; a health check sends a minimal silent WAV
  // just to confirm the endpoint is reachable and authenticated, not that
  // transcription is accurate.
  const sttResult = await timed(() => speechToText({ audio: SILENT_WAV, filename: "health.wav" }));

  return [
    { service: "chat", reachable: chatResult.ok, ...(chatResult.ok ? { latencyMs: chatResult.latencyMs } : { error: chatResult.error }) },
    { service: "tts", reachable: ttsResult.ok, ...(ttsResult.ok ? { latencyMs: ttsResult.latencyMs } : { error: ttsResult.error }) },
    {
      service: "translate",
      reachable: translateResult.ok,
      ...(translateResult.ok ? { latencyMs: translateResult.latencyMs } : { error: translateResult.error }),
    },
    { service: "stt", reachable: sttResult.ok, ...(sttResult.ok ? { latencyMs: sttResult.latencyMs } : { error: sttResult.error }) },
  ];
}

/** A ~0.1s silent 8kHz mono 16-bit PCM WAV, just large enough to be a valid file for the STT reachability probe. */
const SILENT_WAV: Buffer = (() => {
  const sampleRate = 8000;
  const numSamples = 800;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
})();
