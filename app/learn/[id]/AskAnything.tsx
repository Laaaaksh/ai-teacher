"use client";

import { useState, type FormEvent } from "react";
import { CitationList, UngroundedNotice } from "./Citations";
import type { Citation, LessonSession } from "./types";

interface AskResult {
  answer: string;
  grounded: boolean;
  citations: Citation[];
  languageSwitchRequested?: string;
}

/**
 * The student can interrupt at any point — a question, or a request to
 * switch teaching language mid-lesson ("ab hindi mein samjhao"). Answered
 * grounded in the lesson/material with a visible citation, or plainly
 * marked as general knowledge; the lesson position never moves.
 */
export function AskAnything({ sessionId, onLanguageSwitched }: { sessionId: string; onLanguageSwitched: (session: LessonSession) => void }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<"idle" | "asking" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ question: string; result: AskResult }[]>([]);

  async function handleAsk(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setStatus("asking");
    setError(null);
    try {
      const res = await fetch(`/api/teach/sessions/${sessionId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't answer that.");
      setHistory((prev) => [...prev, { question: q, result: data }]);
      setQuestion("");
      setStatus("idle");
      if (data.languageSwitchRequested) onLanguageSwitched(data.session);
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary fixed bottom-6 right-6 shadow-lg">
        Ask a question
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 flex max-h-[70vh] w-full max-w-sm flex-col rounded-xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">Ask anything</p>
        <button type="button" onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100">
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {history.length === 0 && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Interrupt anytime — ask a question, or say something like &ldquo;ab hindi mein samjhao&rdquo; to switch language. The lesson
            resumes where you left off.
          </p>
        )}
        <div className="flex flex-col gap-3">
          {history.map((h, i) => (
            <div key={i} className="text-sm">
              <p className="font-medium text-neutral-900 dark:text-neutral-50">{h.question}</p>
              <p className="mt-1 text-neutral-700 dark:text-neutral-300">{h.result.answer}</p>
              {!h.result.grounded && !h.result.languageSwitchRequested && <UngroundedNotice />}
              <CitationList citations={h.result.citations} />
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={handleAsk} className="flex gap-2 border-t border-neutral-200 p-3 dark:border-neutral-800">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className="input"
          placeholder="Ask a question…"
          disabled={status === "asking"}
        />
        <button type="submit" disabled={status === "asking"} className="btn-primary shrink-0">
          {status === "asking" ? "…" : "Send"}
        </button>
      </form>
      {error && <p className="px-3 pb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
