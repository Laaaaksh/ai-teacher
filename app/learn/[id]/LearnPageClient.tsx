"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LessonPlayer } from "./LessonPlayer";
import { Assessment } from "./Assessment";
import { Report } from "./Report";
import { VisualPreview } from "./VisualPreview";
import { CitationList } from "./Citations";
import type { AssessmentReport, LessonPlan, LessonSession } from "./types";

type Stage = "loading" | "plan" | "teaching" | "assessing" | "report" | "error";

export function LearnPageClient({ sessionId }: { sessionId: string }) {
  const [stage, setStage] = useState<Stage>("loading");
  const [session, setSession] = useState<LessonSession | null>(null);
  const [plan, setPlan] = useState<LessonPlan | null>(null);
  const [scriptingProgress, setScriptingProgress] = useState({ scriptedConcepts: 0, totalConcepts: 0 });
  const [report, setReport] = useState<AssessmentReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function load() {
      try {
        const res = await fetch(`/api/teach/sessions/${sessionId}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "Session not found.");
        setSession(data.session);
        setPlan(data.plan);
        setScriptingProgress(data.scriptingProgress);
        setStage((prev) => (prev === "loading" ? "plan" : prev));
        if (!["ready", "partial", "failed"].includes(data.session.scriptingStatus)) {
          timer = setTimeout(load, 2500);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setStage("error");
        }
      }
    }
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId]);

  if (stage === "error") {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-6 py-16">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        <Link href="/" className="btn-secondary self-start">
          Back to start
        </Link>
      </main>
    );
  }

  if (stage === "loading" || !session || !plan) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Planning your lesson…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      {stage === "plan" && (
        <PlanView
          plan={plan}
          scriptingProgress={scriptingProgress}
          onStart={() => setStage("teaching")}
        />
      )}

      {stage === "teaching" && <LessonPlayer session={session} plan={plan} onFinished={() => setStage("assessing")} />}

      {stage === "assessing" && (
        <Assessment
          sessionId={sessionId}
          onGraded={(r) => {
            setReport(r);
            setStage("report");
          }}
        />
      )}

      {stage === "report" && report && <Report report={report} />}
    </main>
  );
}

function PlanView({
  plan,
  scriptingProgress,
  onStart,
}: {
  plan: LessonPlan;
  scriptingProgress: { scriptedConcepts: number; totalConcepts: number };
  onStart: () => void;
}) {
  const ready = scriptingProgress.scriptedConcepts > 0;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Lesson plan</p>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">{plan.topic}</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {plan.totalMinutes} minutes · {plan.depth} depth · {plan.concepts.length} concepts
        </p>
      </header>

      <div className="flex flex-col gap-4">
        {plan.concepts.map((concept, i) => (
          <div key={concept.id} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                {i + 1}. {concept.title}
              </p>
              <span className="text-xs text-neutral-400">~{Math.round(concept.timeBudgetSeconds / 60)} min</span>
            </div>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{concept.summary}</p>
            <div className="mt-3">
              <VisualPreview visual={concept.visual} />
            </div>
            <CitationList citations={concept.citations} />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={onStart} disabled={!ready} className="btn-primary">
          {ready ? "Start the lesson" : "Preparing the lesson…"}
        </button>
        {!ready && <span className="text-xs text-neutral-500 dark:text-neutral-400">This usually takes under a minute.</span>}
      </div>
    </div>
  );
}
