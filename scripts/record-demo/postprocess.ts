/**
 * Cuts scripts/record-demo/record.ts's raw Playwright recording into
 * docs/assets/demo.mp4 (+ demo.gif). Not a fake edit: every kept frame is
 * real footage of the real app, and every splice is either
 *   (a) a real generated teaching-video clip (downloaded from the app's own
 *       /api/video/:id/download, with its real Sarvam narration audio), or
 *   (b) a short frozen-frame "cut" card, captioned with how long the real
 *       wait actually was, dropped in place of a long dead-air wait (network
 *       indexing, LLM planning, TTS+render jobs) — per the recording rules,
 *       cutting to a labelled card instead of faking speed.
 *
 * Driven entirely by timeline.json (real wall-clock timestamps the recorder
 * logged as it hit each real await) — no video analysis/guessing.
 *
 * Usage: npx tsx scripts/record-demo/postprocess.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(__dirname, "output");
const WORK_DIR = path.join(OUT_DIR, "work");
const CLIPS_DIR = path.join(OUT_DIR, "clips");
const RAW_VIDEO_DIR = path.join(OUT_DIR, "raw-video");
const DOCS_ASSETS = path.join(__dirname, "..", "..", "docs", "assets");

const W = 1280;
const H = 800;
const FPS = 30;
const AR = 44100;

// Any gap between two consecutive log timestamps longer than this is a real
// dead-air wait (network/LLM/TTS/render) and gets cut down to a labelled card.
const GAP_THRESHOLD_MS = 11_000;
const KEEP_HEAD_MS = 1500; // real spinner footage kept right after the wait starts
const KEEP_TAIL_MS = 400;
const CARD_DURATION_S = 3;

interface TimelineEvent {
  t: number;
  label: string;
}
interface VideoManifestEntry {
  label: string;
  src: string;
}

function ffmpeg(args: string[]) {
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
}
function ffprobeDuration(file: string): number {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrapers=1:nokey=1", file,
  ]).toString().trim();
  return parseFloat(out);
}

function findRawVideo(): string {
  const fs = require("node:fs") as typeof import("node:fs");
  const files = fs.readdirSync(RAW_VIDEO_DIR).filter((f: string) => f.endsWith(".webm"));
  if (files.length === 0) throw new Error(`No .webm found in ${RAW_VIDEO_DIR} — run record.ts first.`);
  files.sort((a: string, b: string) => fs.statSync(path.join(RAW_VIDEO_DIR, a)).size - fs.statSync(path.join(RAW_VIDEO_DIR, b)).size);
  return path.join(RAW_VIDEO_DIR, files[files.length - 1]);
}

function currentStageDetail(timeline: TimelineEvent[], atT: number): string {
  let detail = "Working";
  for (const ev of timeline) {
    if (ev.t > atT) break;
    const m = ev.label.match(/^STAGE: .*? — (.+)$/);
    if (m) detail = m[1];
  }
  return detail;
}

function escapeDrawtext(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019");
}

function makeCard(fromNormalizedMp4: string, atSeconds: number, seconds: number, caption: string, outPath: string) {
  // Freeze-frame the moment the cut begins, hold it, caption the real wait.
  const line1 = escapeDrawtext(caption);
  const line2 = escapeDrawtext(`(cut for time — not sped up)`);
  const draw =
    `drawtext=text='${line1}':fontcolor=white:fontsize=30:box=1:boxcolor=black@0.55:boxborderw=16:x=(w-text_w)/2:y=h-140,` +
    `drawtext=text='${line2}':fontcolor=white@0.75:fontsize=20:x=(w-text_w)/2:y=h-90`;
  ffmpeg([
    "-ss", String(Math.max(0, atSeconds)), "-i", fromNormalizedMp4,
    "-vf", `scale=${W}:${H},${draw}`,
    "-t", String(seconds),
    "-r", String(FPS),
    "-vframes", String(seconds * FPS),
    "-loop", "1",
    "-f", "lavfi", "-i", `anullsrc=r=${AR}:cl=stereo`,
    "-map", "0:v", "-map", "1:a",
    "-shortest",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    outPath,
  ].filter((_, i, arr) => true));
}

function encodeSegment(fromMp4: string, startS: number, endS: number, outPath: string) {
  const dur = Math.max(0.1, endS - startS);
  ffmpeg([
    "-ss", String(startS), "-i", fromMp4, "-t", String(dur),
    "-vf", `scale=${W}:${H},setsar=1`,
    "-r", String(FPS),
    "-f", "lavfi", "-i", `anullsrc=r=${AR}:cl=stereo`,
    "-map", "0:v", "-map", "1:a", "-shortest",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    outPath,
  ]);
}

function encodeRealClip(inPath: string, outPath: string) {
  ffmpeg([
    "-i", inPath,
    "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
    "-r", String(FPS),
    "-ar", String(AR), "-ac", "2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    outPath,
  ]);
}

function labelCard(text: string, seconds: number, outPath: string) {
  const esc = escapeDrawtext(text);
  ffmpeg([
    "-f", "lavfi", "-i", `color=c=0x0a0a0a:s=${W}x${H}:d=${seconds}:r=${FPS}`,
    "-f", "lavfi", "-i", `anullsrc=r=${AR}:cl=stereo`,
    "-vf", `drawtext=text='${esc}':fontcolor=white:fontsize=40:x=(w-text_w)/2:y=(h-text_h)/2`,
    "-map", "0:v", "-map", "1:a", "-shortest",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    outPath,
  ]);
}

async function main() {
  mkdirSync(WORK_DIR, { recursive: true });
  mkdirSync(DOCS_ASSETS, { recursive: true });

  const timeline: TimelineEvent[] = JSON.parse(readFileSync(path.join(OUT_DIR, "timeline.json"), "utf8"));
  const manifest: VideoManifestEntry[] = JSON.parse(readFileSync(path.join(OUT_DIR, "video-manifest.json"), "utf8"));
  const rawVideo = findRawVideo();
  console.log("Raw video:", rawVideo);

  const normalized = path.join(WORK_DIR, "00-normalized.mp4");
  console.log("Normalizing raw recording...");
  ffmpeg(["-i", rawVideo, "-vf", `scale=${W}:${H},setsar=1`, "-r", String(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", normalized]);
  const totalDuration = ffprobeDuration(normalized);
  console.log("Normalized duration (s):", totalDuration);

  // ---- Compute long dead-air gaps to cut down to labelled cards ----
  const sorted = [...timeline].sort((a, b) => a.t - b.t);
  const cuts: { startS: number; endS: number; caption: string }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].t - sorted[i - 1].t;
    if (gap > GAP_THRESHOLD_MS) {
      const startMs = sorted[i - 1].t + KEEP_HEAD_MS;
      const endMs = sorted[i].t - KEEP_TAIL_MS;
      if (endMs > startMs + 1000) {
        const detail = currentStageDetail(sorted, sorted[i - 1].t);
        cuts.push({
          startS: startMs / 1000,
          endS: endMs / 1000,
          caption: `Real wait: ~${Math.round(gap / 1000)}s — ${detail}`,
        });
      }
    }
  }
  console.log(`Found ${cuts.length} dead-air gap(s) to cut:`, cuts.map((c) => c.caption));

  // ---- Compute real-clip insertion points from "video ready: <label> (<src>)" log lines ----
  const insertPoints: { atS: number; clipPath: string; label: string }[] = [];
  for (const ev of sorted) {
    const m = ev.label.match(/^video ready: (.+) \((.+)\)$/);
    if (!m) continue;
    const label = m[1];
    const entryIdx = manifest.findIndex((e) => e.label === label);
    if (entryIdx < 0) continue;
    const safeLabel = label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const clipPath = path.join(CLIPS_DIR, `${String(entryIdx).padStart(2, "0")}-${safeLabel}.mp4`);
    if (!existsSync(clipPath)) {
      console.warn(`Missing downloaded clip for "${label}" at ${clipPath}, skipping insertion.`);
      continue;
    }
    insertPoints.push({ atS: ev.t / 1000, clipPath, label });
  }
  console.log(`Found ${insertPoints.length} real teaching-video clip(s) to splice in.`);

  // ---- Build ordered list of boundary points (cuts + inserts) and emit segments ----
  type Boundary =
    | { kind: "cut"; startS: number; endS: number; caption: string }
    | { kind: "insert"; atS: number; clipPath: string; label: string };
  const boundaries: Boundary[] = [
    ...cuts.map((c) => ({ kind: "cut" as const, ...c })),
    ...insertPoints.map((p) => ({ kind: "insert" as const, ...p })),
  ].sort((a, b) => (a.kind === "cut" ? a.startS : a.atS) - (b.kind === "cut" ? b.startS : b.atS));

  const segmentFiles: string[] = [];
  let cursor = 0;
  let n = 0;

  for (const b of boundaries) {
    const pointS = b.kind === "cut" ? b.startS : b.atS;
    if (pointS > cursor + 0.05) {
      const seg = path.join(WORK_DIR, `${String(n++).padStart(3, "0")}-raw.mp4`);
      encodeSegment(normalized, cursor, pointS, seg);
      segmentFiles.push(seg);
    }
    if (b.kind === "cut") {
      const card = path.join(WORK_DIR, `${String(n++).padStart(3, "0")}-cut-card.mp4`);
      makeCard(normalized, b.startS, CARD_DURATION_S, b.caption, card);
      segmentFiles.push(card);
      cursor = b.endS;
    } else {
      const real = path.join(WORK_DIR, `${String(n++).padStart(3, "0")}-real-clip.mp4`);
      encodeRealClip(b.clipPath, real);
      segmentFiles.push(real);
      cursor = b.atS; // raw continues from the same point (the app moved on right after "ended")
    }
  }
  if (cursor < totalDuration - 0.2) {
    const seg = path.join(WORK_DIR, `${String(n++).padStart(3, "0")}-raw.mp4`);
    encodeSegment(normalized, cursor, totalDuration, seg);
    segmentFiles.push(seg);
  }

  // ---- Title + outro cards ----
  const intro = path.join(WORK_DIR, "intro.mp4");
  labelCard("AI Teacher — submission demo\nReal running app, real Sarvam API, real generated video", 3, intro);
  const outro = path.join(WORK_DIR, "outro.mp4");
  labelCard("Every step above is the real running application.", 2.5, outro);

  const allSegments = [intro, ...segmentFiles, outro];
  const listFile = path.join(WORK_DIR, "concat-list.txt");
  writeFileSync(listFile, allSegments.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));

  const finalMp4 = path.join(DOCS_ASSETS, "demo.mp4");
  console.log("Concatenating final video...");
  ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", finalMp4]);
  console.log("Wrote", finalMp4, "duration (s):", ffprobeDuration(finalMp4));

  rmSync(WORK_DIR, { recursive: true, force: true });
  console.log("Done. Now pick the 15s adaptation window and run: npx tsx scripts/record-demo/make-gif.ts <startSeconds>");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
