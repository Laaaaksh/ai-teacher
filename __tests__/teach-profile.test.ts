import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubChatSequence } from "./support/sarvamMock";
import { detectLanguageSwitch, parseTeachingInstruction } from "../lib/teach/profile";

const ORIGINAL_KEY = process.env.SARVAM_API_KEY;

beforeEach(() => {
  process.env.SARVAM_API_KEY = "test-key";
});

afterEach(() => {
  process.env.SARVAM_API_KEY = ORIGINAL_KEY;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("parseTeachingInstruction", () => {
  it("extracts stated fields and falls back to the profile for anything unstated", async () => {
    stubChatSequence({
      topic: "Chapter 4",
      level: "beginner",
      language: "hi-IN",
      minutesAvailable: 20,
      depth: null,
      style: "simple examples",
      wantsQuestions: true,
      wantsFinalAssessment: true,
      scheduleTotalSessions: null,
      scheduleMinutesPerSession: null,
    });

    const intent = await parseTeachingInstruction({
      instruction: "I am a beginner, teach me Chapter 4 in 20 minutes in Hindi with simple examples, ask me questions",
      fallback: { depth: "standard", style: "formal" },
    });

    expect(intent.topic).toBe("Chapter 4");
    expect(intent.level).toBe("beginner");
    expect(intent.language).toBe("hi-IN");
    expect(intent.minutesAvailable).toBe(20);
    expect(intent.depth).toBe("standard"); // filled from fallback since the model returned null
    expect(intent.style).toBe("simple examples");
    expect(intent.wantsQuestions).toBe(true);
    expect(intent.schedule).toBeUndefined();
  });

  it("builds a schedule instead of minutesAvailable for a multi-day request", async () => {
    stubChatSequence({
      topic: "Machine Learning",
      level: null,
      language: null,
      minutesAvailable: null,
      depth: null,
      style: null,
      wantsQuestions: true,
      wantsFinalAssessment: true,
      scheduleTotalSessions: 7,
      scheduleMinutesPerSession: 30,
    });

    const intent = await parseTeachingInstruction({ instruction: "Teach me ML over 7 days, 30 minutes a day" });

    expect(intent.schedule).toEqual({ totalSessions: 7, minutesPerSession: 30 });
    expect(intent.minutesAvailable).toBe(30);
  });
});

describe("detectLanguageSwitch", () => {
  it("returns the requested language for a mid-lesson switch request", async () => {
    stubChatSequence({ requestedLanguage: "hi-IN" });
    const result = await detectLanguageSwitch("ab hindi mein samjhao", "en-IN");
    expect(result).toBe("hi-IN");
  });

  it("returns null for an ordinary question that isn't a language switch", async () => {
    stubChatSequence({ requestedLanguage: null });
    const result = await detectLanguageSwitch("what is Ohm's law again?", "en-IN");
    expect(result).toBeNull();
  });
});
