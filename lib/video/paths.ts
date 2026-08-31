import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";

/** Root directory for all generated video artifacts (narration WAVs, per-scene MP4s, final lessons). Override with VIDEO_CACHE_DIR (tests use a tmp dir). */
function resolveVideoCacheRoot(): string {
  const configured = process.env.VIDEO_CACHE_DIR;
  const root = configured ?? path.join(process.cwd(), "data", "video-cache");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function audioCacheDir(): string {
  const dir = path.join(resolveVideoCacheRoot(), "audio");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function sceneCacheDir(): string {
  const dir = path.join(resolveVideoCacheRoot(), "scenes");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function outputDir(): string {
  const dir = path.join(resolveVideoCacheRoot(), "output");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Scratch directory for one scene's captured PNG frames. Unique per call, not per scene hash: two jobs rendering the same scene concurrently must not interleave frames into — or delete — each other's directory. */
export function createFramesDir(sceneHash: string): string {
  const dir = path.join(resolveVideoCacheRoot(), "frames", `${sceneHash}-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
