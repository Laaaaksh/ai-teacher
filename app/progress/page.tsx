"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getStoredLearnerProfileId } from "@/lib/client/learner";

interface LearnerProfile {
  id: string;
  name: string;
  level: string;
  language: string;
}

interface SessionEntry {
  session: {
    id: string;
    topic: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    language: string;
  };
  report: { score: number } | null;
}

interface ConceptProgressRow {
  conceptId: string;
  conceptTitle: string;
  mastery: string;
  masteryScore: number;
  lastAssessedAt: string;
}

interface LearningPathStep {
  id: string;
  order: number;
  title: string;
  status: "locked" | "available" | "in-progress" | "completed";
}

interface LearningPathRow {
  id: string;
  topic: string;
  steps: LearningPathStep[];
  currentStepIndex: number;
}

const MASTERY_COLOR: Record<string, string> = {
  "not-started": "bg-neutral-200 dark:bg-neutral-700",
  struggling: "bg-red-400",
  developing: "bg-amber-400",
  proficient: "bg-emerald-400",
  mastered: "bg-emerald-600",
};

/**
 * A learner's progress across every session — what makes a second session
 * personalized by the first, and a listed rubric item on its own.
 */
export default function ProgressPage() {
  const [profileId, setProfileId] = useState<string | null | undefined>(undefined);
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [conceptProgress, setConceptProgress] = useState<ConceptProgressRow[]>([]);
  const [learningPaths, setLearningPaths] = useState<LearningPathRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProfileId(getStoredLearnerProfileId());
  }, []);

  useEffect(() => {
    if (!profileId) return;
    fetch(`/api/progress?learnerProfileId=${profileId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Couldn't load progress.");
        setProfile(data.profile);
        setSessions(data.sessions);
        setConceptProgress(data.conceptProgress);
        setLearningPaths(data.learningPaths);
      })
      .catch((err) => setError((err as Error).message));
  }, [profileId]);

  if (profileId === undefined) return null;

  if (!profileId) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <p className="text-neutral-600 dark:text-neutral-400">No lessons yet — start one to build your progress history.</p>
        <Link href="/" className="btn-primary">
          Start a lesson
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">Your progress</h1>
        {profile && <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{profile.name} · {profile.level}</p>}
      </header>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <section>
        <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-50">Sessions</h2>
        {sessions.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">No sessions yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {sessions.map(({ session, report }) => (
              <li key={session.id} className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
                <div>
                  <p className="font-medium text-neutral-900 dark:text-neutral-50">{session.topic}</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {new Date(session.startedAt).toLocaleDateString()} · {session.status}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {report && <span className="font-medium text-neutral-700 dark:text-neutral-300">{Math.round(report.score)}%</span>}
                  <Link href={`/learn/${session.id}`} className="text-xs text-neutral-500 underline hover:text-neutral-900 dark:hover:text-neutral-100">
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-50">Concept mastery</h2>
        {conceptProgress.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Nothing assessed yet.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {conceptProgress.map((c) => (
              <div key={c.conceptId} className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${MASTERY_COLOR[c.mastery] ?? "bg-neutral-300"}`} />
                <span className="flex-1 text-neutral-800 dark:text-neutral-200">{c.conceptTitle}</span>
                <span className="text-xs capitalize text-neutral-500 dark:text-neutral-400">{c.mastery.replace("-", " ")}</span>
                <span className="w-10 text-right text-xs text-neutral-400">{Math.round(c.masteryScore)}%</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {learningPaths.length > 0 && (
        <section>
          <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-50">Learning paths</h2>
          <div className="mt-3 flex flex-col gap-3">
            {learningPaths.map((path) => (
              <Link
                key={path.id}
                href={`/paths/${path.id}`}
                className="block rounded-lg border border-neutral-200 bg-white p-4 text-sm hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
              >
                <p className="font-medium text-neutral-900 dark:text-neutral-50">{path.topic}</p>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Step {path.currentStepIndex + 1} of {path.steps.length}: {path.steps[path.currentStepIndex]?.title}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
