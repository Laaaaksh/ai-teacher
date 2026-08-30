import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000); // keep only the tail for error reporting
    });
    proc.on("error", (err) => reject(new Error(`Failed to start ffmpeg: ${err.message}. Is ffmpeg installed and on PATH?`)));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}:\n${stderr}`));
    });
  });
}

/** Encodes a directory of frame-%06d.png images plus a WAV narration track into an H.264/yuv420p MP4, trimmed to the shorter of the two ("-shortest") so rounding between frame count and audio duration never leaves a silent/frozen tail. */
export async function encodeSceneVideo(params: { framesDir: string; fps: number; audioPath: string; outputPath: string }): Promise<void> {
  fs.mkdirSync(path.dirname(params.outputPath), { recursive: true });
  // Encode to a unique temp file and rename into place: the output path is a
  // shared content-addressed cache entry, so two concurrent renders of the
  // same scene would otherwise have two ffmpeg processes writing one file.
  const tempPath = `${params.outputPath}.${randomUUID()}.tmp.mp4`;
  try {
    await runFfmpeg([
      "-y",
      "-framerate",
      String(params.fps),
      "-i",
      path.join(params.framesDir, "frame-%06d.png"),
      "-i",
      params.audioPath,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      tempPath,
    ]);
    fs.renameSync(tempPath, params.outputPath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

/** Concatenates same-codec MP4s via the concat demuxer with a stream copy (no re-encode, bounded memory/time regardless of total lesson length). */
export async function concatVideos(inputPaths: string[], outputPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const listPath = `${outputPath}.concat.txt`;
  const listContent = inputPaths.map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(listPath, listContent);

  try {
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath]);
  } finally {
    fs.rmSync(listPath, { force: true });
  }
}
