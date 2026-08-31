"use client";

import { useEffect, useState } from "react";
import type { AssessmentReport, Question } from "./types";

/** The final quiz — drawn from the concepts actually taught, weighted toward whatever was missed at checkpoints — then submitted for grading. */
export function Assessment({ sessionId, onGraded }: { sessionId: string; onGraded: (report: AssessmentReport) => void }) {
  const [quiz, setQuiz] = useState<Question[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"loading" | "answering" | "submitting" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/teach/sessions/${sessionId}/assess`, { method: "POST" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Couldn't build the final quiz.");
        if (!cancelled) {
          setQuiz(data.quiz);
          setStatus("answering");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError((err as Error).message);
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function handleSubmit() {
    if (!quiz) return;
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch(`/api/teach/sessions/${sessionId}/assess/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: quiz.map((q) => ({ questionId: q.id, studentAnswer: answers[q.id]?.trim() || "(no answer)" })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't grade the quiz.");
      onGraded(data.report);
    } catch (err) {
      setError((err as Error).message);
      setStatus("answering");
    }
  }

  if (status === "loading") {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">Building your final quiz…</p>;
  }
  if (status === "error" && !quiz) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }
  if (!quiz) return null;

  const answeredCount = quiz.filter((q) => answers[q.id]?.trim()).length;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">Final check</h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {answeredCount} of {quiz.length} answered
        </p>
      </header>

      {quiz.map((q, i) => (
        <div key={q.id} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
            {i + 1}. {q.prompt}
          </p>
          {q.type === "mcq" && q.options?.length ? (
            <div className="mt-3 flex flex-col gap-2">
              {q.options.map((opt) => (
                <label key={opt} className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                  <input
                    type="radio"
                    name={q.id}
                    checked={answers[q.id] === opt}
                    onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                  />
                  {opt}
                </label>
              ))}
            </div>
          ) : (
            <textarea
              value={answers[q.id] ?? ""}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
              className="input mt-3 min-h-20"
              placeholder="Your answer…"
            />
          )}
        </div>
      ))}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button type="button" onClick={handleSubmit} disabled={status === "submitting"} className="btn-primary self-start">
        {status === "submitting" ? "Grading…" : "Submit quiz"}
      </button>
    </div>
  );
}
