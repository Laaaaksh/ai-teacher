import { NextRequest, NextResponse } from "next/server";
import { isSarvamError, speechToText } from "@/lib/sarvam";
import { LANGUAGE_CODES } from "@/lib/teach/profile";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/** Multipart boundaries and part headers add a little on top of the audio itself, so the header-level check needs slack or a recording right at the cap is rejected. */
const MAX_REQUEST_BYTES = MAX_AUDIO_BYTES + 1024 * 1024;

/** "hinglish" isn't a real STT language code — recorded Hinglish speech is still mostly Hindi phonetically, so ask Sarvam for Hindi rather than omitting the hint entirely. */
function sttLanguageCode(languageCode: string | null): string | undefined {
  if (!languageCode) return undefined;
  if (languageCode === "hinglish") return "hi-IN";
  return (LANGUAGE_CODES as readonly string[]).includes(languageCode) ? languageCode : undefined;
}

/** Transcribes a recorded answer so the student can answer a checkpoint question by voice instead of typing (Sarvam speech-to-text). */
export async function POST(req: NextRequest) {
  /* req.formData() buffers the whole body, so the cap has to be enforced from
   * the header first (same reason as app/api/documents/route.ts). A client
   * that omits Content-Length (chunked transfer) slips past this and is only
   * caught by the audio.size check below, after buffering. */
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return NextResponse.json(
      { error: `Request body exceeds the ${MAX_AUDIO_BYTES / (1024 * 1024)}MB audio limit.` },
      { status: 413 },
    );
  }

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
