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

export function framesDirFor(sceneHash: string): string {
  const dir = path.join(resolveVideoCacheRoot(), "frames", sceneHash);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
