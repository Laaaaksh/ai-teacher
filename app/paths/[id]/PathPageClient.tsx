"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredLearnerProfileId } from "@/lib/client/learner";

interface LearningPathStep {
  id: string;
  order: number;
  title: string;
  status: "locked" | "available" | "in-progress" | "completed";
}

interface LearningPath {
  id: string;
  learnerProfileId: string;
  topic: string;
  steps: LearningPathStep[];
  currentStepIndex: number;
}

const STATUS_LABEL: Record<string, string> = {
  locked: "Locked",
  available: "Ready to start",
  "in-progress": "In progress",
  completed: "Completed",
};

export function PathPageClient({ pathId }: { pathId: string }) {
  const router = useRouter();
  const [path, setPath] = useState<LearningPath | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/teach/paths/${pathId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Learning path not found.");
        setPath(data.path);
      })
      .catch((err) => setError((err as Error).message));
  }, [pathId]);

  async function startStep(step: LearningPathStep) {
    if (!path) return;
    setStarting(step.id);
    setError(null);
    try {
      const learnerProfileId = getStoredLearnerProfileId() ?? path.learnerProfileId;
      const profileRes = await fetch(`/api/profile/${learnerProfileId}`);
      const profileData = await profileRes.json();
      if (!profileRes.ok) throw new Error(profileData.error ?? "Couldn't load your profile.");
      const profile = profileData.profile;

      const res = await fetch("/api/teach/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          learnerProfileId,
          topic: step.title,
          totalMinutes: profile.minutesAvailable,
          depth: profile.depth,
          language: profile.language,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start this step.");
      router.push(`/learn/${data.session.id}`);
    } catch (err) {
      setError((err as Error).message);
      setStarting(null);
    }
  }

  if (error && !path) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-16">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      </main>
    );
  }
  if (!path) return null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Learning path</p>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">{path.topic}</h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          Each step becomes its own lesson, generated when you start it. Finishing a step here doesn&apos;t yet auto-unlock the
          next one — start any step marked ready whenever you&apos;re there.
        </p>
      </header>

      <ol className="flex flex-col gap-3">
        {path.steps.map((step, i) => (
          <li key={step.id} className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <div>
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                {i + 1}. {step.title}
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{STATUS_LABEL[step.status]}</p>
            </div>
            {step.status !== "locked" && (
              <button type="button" onClick={() => startStep(step)} disabled={starting === step.id} className="btn-secondary shrink-0">
                {starting === step.id ? "Starting…" : "Start"}
              </button>
            )}
          </li>
        ))}
      </ol>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </main>
  );
}
