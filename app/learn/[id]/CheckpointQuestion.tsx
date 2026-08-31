"use client";

import { useRef, useState } from "react";
import type { Question } from "./types";

/**
 * A real checkpoint question — MCQ, short-answer, or explain-in-your-own-
 * words — answered by typing or by voice (Sarvam speech-to-text via
 * POST /api/speech). The reference answer is never sent to the client.
 */
export function CheckpointQuestion({
  question,
  language,
  onSubmit,
  submitting,
}: {
  question: Question;
  language: string;
  onSubmit: (answer: string) => void;
  submitting: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const isMcq = question.type === "mcq" && question.options && question.options.length > 0;

  function handleSubmit() {
    const answer = isMcq ? selected : text;
    if (!answer?.trim()) return;
    onSubmit(answer.trim());
  }

  async function toggleRecording() {
    setVoiceError(null);
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setTranscribing(true);
        try {
          const formData = new FormData();
          formData.append("audio", blob, "answer.webm");
          formData.append("languageCode", language);
          const res = await fetch("/api/speech", { method: "POST", body: formData });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Couldn't transcribe that.");
          setText((prev) => (prev ? `${prev} ${data.transcript}` : data.transcript));
        } catch (err) {
          setVoiceError((err as Error).message);
        } finally {
          setTranscribing(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setVoiceError("Microphone access was denied or is unavailable — you can still type your answer.");
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Checkpoint</p>
      <p className="mt-2 text-lg font-medium text-neutral-900 dark:text-neutral-50">{question.prompt}</p>

      {isMcq ? (
        <div className="mt-4 flex flex-col gap-2">
          {question.options!.map((opt) => (
            <label
              key={opt}
              className={`cursor-pointer rounded-lg border px-4 py-2.5 text-sm transition-colors ${
                selected === opt
                  ? "border-neutral-900 bg-neutral-50 dark:border-neutral-100 dark:bg-neutral-800"
                  : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
              }`}
            >
              <input type="radio" name="mcq" value={opt} checked={selected === opt} onChange={() => setSelected(opt)} className="mr-2" />
              {opt}
            </label>
          ))}
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="input min-h-24"
            placeholder="Type your answer, or use the microphone…"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleRecording}
              disabled={transcribing}
              className={`btn-secondary ${recording ? "border-red-500 text-red-600 dark:text-red-400" : ""}`}
            >
              {recording ? "⏹ Stop recording" : transcribing ? "Transcribing…" : "🎤 Answer by voice"}
            </button>
            {voiceError && <span className="text-xs text-red-600 dark:text-red-400">{voiceError}</span>}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting || (isMcq ? !selected : !text.trim())}
        className="btn-primary mt-4"
      >
        {submitting ? "Checking…" : "Submit answer"}
      </button>
    </div>
  );
}
