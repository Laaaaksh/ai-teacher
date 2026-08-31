import path from "node:path";
import { completeVideoJob, createVideoJob, failVideoJob, getVideoJob, updateVideoJobProgress } from "../db";
import type { VideoJobRow } from "../db/types";
import { DEFAULT_PERSONA_ID } from "./avatar/personas";
import { outputDir } from "./paths";
import { renderLessonVideo } from "./render";

/**
 * In-process job runner: the render itself is a long-running async function
 * kicked off (not awaited) by the API route, with progress written to the
 * video_jobs table so a client can poll GET /api/video/:jobId. This is a
 * single-process job queue with no persistent worker — fine for one local
 * `next start`/`next dev` instance, not a multi-instance/serverless
 * deployment (see docs/VIDEO.md known limitations).
 */
export function startVideoJob(lessonPlanId: string, personaId: string = DEFAULT_PERSONA_ID): VideoJobRow {
  const job = createVideoJob({ lessonPlanId, personaId });
  const outputPath = path.join(outputDir(), `${job.id}.mp4`);

  void renderLessonVideo(lessonPlanId, outputPath, {
    personaId,
    onProgress: (progress) => {
      updateVideoJobProgress(job.id, progress.stage, progress.percent, progress.detail);
    },
  })
    .then(() => {
      completeVideoJob(job.id, outputPath);
    })
    .catch((err: unknown) => {
      failVideoJob(job.id, err instanceof Error ? err.message : String(err));
    });

  return job;
}

export function getVideoJobStatus(jobId: string): VideoJobRow | undefined {
  return getVideoJob(jobId);
}
