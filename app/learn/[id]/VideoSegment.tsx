"use client";

import { useEffect, useRef, useState } from "react";

interface VideoJobStatus {
  jobId: string;
  status: "queued" | "narrating" | "rendering" | "muxing" | "completed" | "failed";
  progressPercent: number;
  stageDetail: string | null;
  errorMessage: string | null;
  downloadUrl: string | null;
}

const STAGE_LABEL: Record<string, string> = {
  queued: "Queued",
  narrating: "Recording narration",
  rendering: "Rendering visuals",
  muxing: "Encoding video",
  completed: "Ready",
  failed: "Failed",
};

/**
 * Renders one teaching segment (a set of scene ids) as a real video and
 * plays it. The lesson player renders one segment at a time — a concept's
 * teaching beats, or a single re-explanation scene after a wrong answer —
 * rather than the whole multi-concept lesson up front, since later
 * segments (especially adaptation scenes) don't exist until the learner
 * gets there. See lib/video/render.ts's sceneIds option.
 */
export function VideoSegment({
  lessonPlanId,
  sceneIds,
  skipTitleCard,
  personaId,
  onEnded,
}: {
  lessonPlanId: string;
  sceneIds: string[];
  skipTitleCard?: boolean;
  personaId?: string;
  onEnded: () => void;
}) {
  const [job, setJob] = useState<VideoJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sceneKey = sceneIds.join(",");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setJob(null);
    setError(null);
    setEnded(false);

    async function start() {
      try {
        const res = await fetch("/api/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lessonPlanId, sceneIds, skipTitleCard, personaId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to start video render.");
        if (!cancelled) poll(data.jobId);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }

    async function poll(jobId: string) {
      try {
        const res = await fetch(`/api/video/${jobId}`);
        const data: VideoJobStatus = await res.json();
        if (cancelled) return;
        setJob(data);
        if (data.status === "failed") {
          setError(data.errorMessage ?? "Video rendering failed.");
          return;
        }
        if (data.status !== "completed") timer = setTimeout(() => poll(jobId), 1500);
      } catch {
        if (!cancelled) timer = setTimeout(() => poll(jobId), 2000);
      }
    }

    start();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonPlanId, sceneKey, skipTitleCard, personaId]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        <p>Couldn&apos;t render this part of the lesson: {error}</p>
        <button type="button" onClick={onEnded} className="btn-secondary mt-3">
          Continue anyway
        </button>
      </div>
    );
  }

  if (!job || job.status !== "completed" || !job.downloadUrl) {
    const pct = job?.progressPercent ?? 0;
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg bg-neutral-900 p-6 text-white">
        <p className="text-sm font-medium">{STAGE_LABEL[job?.status ?? "queued"]}…</p>
        <div className="h-1.5 w-2/3 overflow-hidden rounded-full bg-white/20">
          <div className="h-full bg-white transition-all" style={{ width: `${pct}%` }} />
        </div>
        {job?.stageDetail && <p className="text-xs text-white/60">{job.stageDetail}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <video
        ref={videoRef}
        src={job.downloadUrl}
        controls
        playsInline
        className="w-full rounded-lg bg-black"
        onEnded={() => {
          if (!ended) {
            setEnded(true);
            onEnded();
          }
        }}
      />
      {ended && (
        <button type="button" onClick={onEnded} className="btn-secondary self-start">
          Continue →
        </button>
      )}
    </div>
  );
}
