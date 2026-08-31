import { NextRequest, NextResponse } from "next/server";
import { isSarvamError, speechToText } from "@/lib/sarvam";
import { LANGUAGE_CODES } from "@/lib/teach/profile";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/** "hinglish" isn't a real STT language code — recorded Hinglish speech is still mostly Hindi phonetically, so ask Sarvam for Hindi rather than omitting the hint entirely. */
function sttLanguageCode(languageCode: string | null): string | undefined {
  if (!languageCode) return undefined;
  if (languageCode === "hinglish") return "hi-IN";
  return (LANGUAGE_CODES as readonly string[]).includes(languageCode) ? languageCode : undefined;
}

/** Transcribes a recorded answer so the student can answer a checkpoint question by voice instead of typing (Sarvam speech-to-text). */
export async function POST(req: NextRequest) {
  const formData = await req.formData().catch(() => undefined);
  const audio = formData?.get("audio");
  if (!(audio instanceof File)) {
    return NextResponse.json({ error: "Expected a multipart form with an 'audio' field." }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: `Audio is ${(audio.size / (1024 * 1024)).toFixed(1)}MB; the limit is ${MAX_AUDIO_BYTES / (1024 * 1024)}MB.` }, { status: 413 });
  }

  const languageCode = sttLanguageCode(formData!.get("languageCode") as string | null);
  const buffer = Buffer.from(await audio.arrayBuffer());

  try {
    const { transcript } = await speechToText({ audio: buffer, filename: audio.name || "answer.wav", languageCode });
    return NextResponse.json({ transcript });
  } catch (err) {
    if (isSarvamError(err)) {
      return NextResponse.json({ error: `Transcription failed: ${err.message}`, kind: err.kind }, { status: 502 });
    }
    console.error("Speech-to-text failed:", err);
    return NextResponse.json({ error: "Failed to transcribe audio." }, { status: 500 });
  }
}
