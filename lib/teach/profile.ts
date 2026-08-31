/**
 * "Understand" — turns a learner profile (level, prior knowledge, goal,
 * style, language, minutes available, depth) plus a free-text instruction
 * such as "I am a beginner, teach me Chapter 4 in 20 minutes in Hindi with
 * simple examples, ask me questions" into a structured TeachingIntent.
 *
 * The learner never fills twelve fields: whatever the instruction states
 * overrides the stored profile default; whatever it omits falls back to the
 * profile, then to a sane default. Parsing goes through sarvam-105b rather
 * than regex, because "20 minutes in Hindi" is easy to catch with a pattern
 * but "give me the short version, I only have till my next class" is not —
 * and the assessment is explicit that free text should not require the
 * learner to fill a form.
 */
import { z } from "zod";
import { json } from "./llm";
import type { LanguageCode, LearnerLevel, LearningDepth } from "../types";

export const LANGUAGE_CODES = [
  "en-IN",
  "hi-IN",
  "hinglish",
  "bn-IN",
  "ta-IN",
  "te-IN",
  "mr-IN",
  "kn-IN",
  "gu-IN",
  "ml-IN",
  "pa-IN",
] as const satisfies readonly LanguageCode[];

export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  "en-IN": "English",
  "hi-IN": "Hindi (Devanagari script)",
  hinglish: "Hinglish — English text with natural Hindi code-switching, Latin script",
  "bn-IN": "Bengali",
  "ta-IN": "Tamil",
  "te-IN": "Telugu",
  "mr-IN": "Marathi",
  "kn-IN": "Kannada",
  "gu-IN": "Gujarati",
  "ml-IN": "Malayalam",
  "pa-IN": "Punjabi",
};

/**
 * A language-code string like "en-IN" is not a reliable instruction on its
 * own — verified live, the model sometimes ignores it and writes in Hindi
 * regardless. Every prompt that needs the model to write in a specific
 * language should use this instead of naming the raw code.
 */
export function languageInstruction(code: LanguageCode): string {
  return `Write in ${LANGUAGE_NAMES[code]} (language code "${code}").`;
}

/** A multi-day/multi-session request ("teach me over 7 days, 30 minutes a day") — routed to lib/teach/path.ts instead of a single LessonPlan. */
export interface ScheduleRequest {
  totalSessions: number;
  minutesPerSession: number;
}

export interface TeachingIntent {
  /** What to teach, in the learner's own words ("Chapter 4", "Newton's Laws", "React for interviews"). */
  topic: string;
  level: LearnerLevel;
  language: LanguageCode;
  minutesAvailable: number;
  depth: LearningDepth;
  style: string;
  /** The learner asked to be questioned during the lesson (default true — a monologue fails the spec's "not a chatbot" bar either way, but the instruction can request more/less interaction emphasis via `style`). */
  wantsQuestions: boolean;
  /** The learner asked to be tested/assessed at the end. */
  wantsFinalAssessment: boolean;
  schedule?: ScheduleRequest;
  rawInstruction: string;
}

const IntentSchema = z.object({
  topic: z.string().nullable(),
  level: z.enum(["beginner", "intermediate", "advanced"]).nullable(),
  language: z.enum(LANGUAGE_CODES).nullable(),
  minutesAvailable: z.number().int().positive().max(600).nullable(),
  depth: z.enum(["overview", "standard", "deep"]).nullable(),
  style: z.string().nullable(),
  wantsQuestions: z.boolean(),
  wantsFinalAssessment: z.boolean(),
  scheduleTotalSessions: z.number().int().positive().max(60).nullable(),
  scheduleMinutesPerSession: z.number().int().positive().max(600).nullable(),
});

export interface ParseTeachingInstructionInput {
  instruction: string;
  /** Stored learner profile fields, used to fill in anything the instruction doesn't state. Every field optional so a first-time learner with no saved profile still works. */
  fallback?: Partial<{
    topic: string;
    level: LearnerLevel;
    language: LanguageCode;
    minutesAvailable: number;
    depth: LearningDepth;
    style: string;
  }>;
}

export async function parseTeachingInstruction(input: ParseTeachingInstructionInput): Promise<TeachingIntent> {
  const parsed = await json(IntentSchema, {
    messages: [
      {
        role: "system",
        content:
          "You extract structured teaching preferences from a student's free-text instruction to an AI teacher. " +
          "Only fill a field from the instruction text itself; if the instruction does not mention something, return null for it (a fallback will fill it in) — never guess. " +
          "minutesAvailable is per-session minutes for a SINGLE session; fill it whenever the student states one session's duration (e.g. '20 minutes', '5 minutes'), even without the word 'session'. " +
          "Only fill scheduleTotalSessions/scheduleMinutesPerSession (leaving minutesAvailable null) when the student explicitly asks for MULTIPLE distinct sessions/days (e.g. 'over 7 days', '30 minutes a day for two weeks') — never set scheduleTotalSessions to 1. " +
          "wantsQuestions and wantsFinalAssessment default to true unless the instruction clearly asks NOT to be questioned/tested. " +
          `\n\nRespond with ONLY a JSON object of exactly this shape (no other keys, no markdown fences):\n` +
          `{"topic": string or null, "level": one of "beginner"|"intermediate"|"advanced" or null, "language": one of "en-IN"|"hi-IN"|"hinglish"|"bn-IN"|"ta-IN"|"te-IN"|"mr-IN"|"kn-IN"|"gu-IN"|"ml-IN"|"pa-IN" or null, ` +
          `"minutesAvailable": integer or null, "depth": one of "overview"|"standard"|"deep" or null, "style": string or null, "wantsQuestions": boolean, "wantsFinalAssessment": boolean, ` +
          `"scheduleTotalSessions": integer or null, "scheduleMinutesPerSession": integer or null}`,
      },
      { role: "user", content: input.instruction },
    ],
  });

  const fallback = input.fallback ?? {};

  const schedule =
    parsed.scheduleTotalSessions && parsed.scheduleMinutesPerSession
      ? { totalSessions: parsed.scheduleTotalSessions, minutesPerSession: parsed.scheduleMinutesPerSession }
      : undefined;

  return {
    topic: parsed.topic?.trim() || fallback.topic || "",
    level: parsed.level ?? fallback.level ?? "beginner",
    language: parsed.language ?? fallback.language ?? "en-IN",
    minutesAvailable: schedule ? schedule.minutesPerSession : (parsed.minutesAvailable ?? fallback.minutesAvailable ?? 20),
    depth: parsed.depth ?? fallback.depth ?? "standard",
    style: parsed.style?.trim() || fallback.style || "example-driven",
    wantsQuestions: parsed.wantsQuestions,
    wantsFinalAssessment: parsed.wantsFinalAssessment,
    schedule,
    rawInstruction: input.instruction,
  };
}

const LanguageSwitchSchema = z.object({
  /** Non-null only when the message is actually asking to change the teaching language, not just mentioning a language in passing. */
  requestedLanguage: z.enum(LANGUAGE_CODES).nullable(),
});

/**
 * Detects a mid-lesson language-switch request ("ab hindi mein samjhao",
 * "now explain it in English") in an otherwise ordinary message. Returns
 * null when the message isn't asking to switch languages, so callers (e.g.
 * lib/teach/ask.ts) can fall through to treating it as a normal question.
 */
export async function detectLanguageSwitch(message: string, currentLanguage: LanguageCode): Promise<LanguageCode | null> {
  const result = await json(LanguageSwitchSchema, {
    messages: [
      {
        role: "system",
        content:
          `The student is mid-lesson, currently being taught in language code "${currentLanguage}". ` +
          "Decide whether their message is asking the teacher to switch teaching language (in any language/script, including Hinglish). " +
          "If yes, return the target language code. If the message is a normal question/answer/comment that happens to mention a language, return null. " +
          `Respond with ONLY a JSON object of exactly this shape: {"requestedLanguage": one of "en-IN"|"hi-IN"|"hinglish"|"bn-IN"|"ta-IN"|"te-IN"|"mr-IN"|"kn-IN"|"gu-IN"|"ml-IN"|"pa-IN" or null}`,
      },
      { role: "user", content: message },
    ],
    temperature: 0,
  });
  return result.requestedLanguage;
}
