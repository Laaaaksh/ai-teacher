/** Request/response shapes for the Sarvam APIs this client wraps. See docs/ARCHITECTURE.md for the verified endpoint contracts. */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  /**
   * sarvam-105b is a reasoning model: it fills `reasoning_content` before
   * `content`. Too small a value returns `finish_reason: "length"` with
   * `content: null` before any real answer is written. Default is generous
   * on purpose — see DEFAULT_MAX_TOKENS in client.ts.
   */
  maxTokens?: number;
  temperature?: number;
  responseFormat?: { type: "json_object" };
}

export interface ChatCompletionResult {
  content: string;
  /** Present when the model is a reasoning model and emitted a reasoning trace. */
  reasoningContent?: string;
  finishReason: string;
  raw: unknown;
}

export type SarvamSpeaker =
  | "aditya"
  | "ritu"
  | "priya"
  | "neha"
  | "rahul"
  | "kavya"
  | "ishita"
  | "shreya"
  | "varun"
  | "tanya";

export interface TextToSpeechRequest {
  text: string;
  /** bulbul:v3 speaker; v2 speakers like "anushka" are rejected by v3 and will surface as an http error. */
  speaker?: SarvamSpeaker;
  languageCode?: string;
  pace?: number;
}

export interface TextToSpeechResult {
  /** Decoded WAV audio. */
  audio: Buffer;
  raw: unknown;
}

export interface TranslateRequest {
  input: string;
  sourceLanguageCode: string;
  targetLanguageCode: string;
}

export interface TranslateResult {
  translatedText: string;
  raw: unknown;
}

export interface SpeechToTextRequest {
  /** Raw audio bytes (wav/mp3/etc — whatever Sarvam's STT accepts). */
  audio: Buffer;
  filename?: string;
  languageCode?: string;
}

export interface SpeechToTextResult {
  transcript: string;
  raw: unknown;
}

export interface HealthCheckResult {
  service: "chat" | "tts" | "translate" | "stt";
  reachable: boolean;
  latencyMs?: number;
  error?: string;
}
