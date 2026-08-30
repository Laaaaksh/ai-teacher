import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectLanguage } from "../lib/rag/language";

const ORIGINAL_ENV = process.env.SARVAM_API_KEY;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  process.env.SARVAM_API_KEY = "test-key";
  vi.resetModules();
});

afterEach(() => {
  process.env.SARVAM_API_KEY = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

describe("detectLanguage", () => {
  it("detects Devanagari as Hindi", () => {
    expect(detectLanguage("ओम का नियम विद्युत परिपथ में")).toBe("hi-IN");
  });

  it("detects Bengali script", () => {
    expect(detectLanguage("আলোক সংশ্লেষণ")).toBe("bn-IN");
  });

  it("detects Tamil script", () => {
    expect(detectLanguage("ஓம் விதி")).toBe("ta-IN");
  });

  it("picks the dominant script, not the first one that appears", () => {
    expect(detectLanguage("Ohm's Law, written ओम, relates voltage and current in a resistive circuit.")).toBe("en-IN");
    expect(detectLanguage("ओम का नियम voltage और current को जोड़ता है")).toBe("hi-IN");
  });

  it("falls back to English for Latin-script text, including Hinglish", () => {
    expect(detectLanguage("Ohm's Law relates voltage and current.")).toBe("en-IN");
    expect(detectLanguage("Yeh circuit ka basic law hai.")).toBe("en-IN");
  });
});

describe("translateQueryForRetrieval", () => {
  it("returns the query unchanged when languages already match, without calling Sarvam", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { translateQueryForRetrieval } = await import("../lib/rag/language");
    const result = await translateQueryForRetrieval("What is Ohm's Law?", "en-IN", "en-IN");

    expect(result).toBe("What is Ohm's Law?");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats hinglish as English for translation purposes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { translateQueryForRetrieval } = await import("../lib/rag/language");
    const result = await translateQueryForRetrieval("Ohm ka law kya hai", "hinglish", "en-IN");

    expect(result).toBe("Ohm ka law kya hai");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls Sarvam translate when the query language differs from the corpus language", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ translated_text: "What is Ohm's Law?" }));
    vi.stubGlobal("fetch", fetchMock);

    const { translateQueryForRetrieval } = await import("../lib/rag/language");
    const result = await translateQueryForRetrieval("ओम का नियम क्या है?", "hi-IN", "en-IN");

    expect(result).toBe("What is Ohm's Law?");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
