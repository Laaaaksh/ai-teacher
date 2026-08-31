/**
 * Cuts a 15-second GIF out of docs/assets/demo.mp4 for the README — the
 * adaptation moment (wrong answer -> misconception named -> re-explanation).
 * Two-pass palette approach (palettegen/paletteuse) for a smaller, cleaner
 * GIF than a naive single-pass encode; kept under GitHub's practical README
 * size budget (a few MB) at 640px/12fps.
 *
 * Usage: npx tsx scripts/record-demo/make-gif.ts <startSeconds> [durationSeconds]
 * Requires FFMPEG_BIN (see postprocess.ts) if the platform default ffmpeg
 * lacks the filters used here — it doesn't for this script (no drawtext).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const FFMPEG_BIN = process.env.FFMPEG_BIN ?? "ffmpeg";
const DOCS_ASSETS = path.join(__dirname, "..", "..", "docs", "assets");
const SRC = path.join(DOCS_ASSETS, "demo.mp4");
const OUT = path.join(DOCS_ASSETS, "demo.gif");

function ffmpeg(args: string[]) {
  execFileSync(FFMPEG_BIN, ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
}

function main() {
  const start = Number(process.argv[2]);
  const duration = Number(process.argv[3] ?? 15);
  if (!Number.isFinite(start)) {
    console.error("Usage: npx tsx scripts/record-demo/make-gif.ts <startSeconds> [durationSeconds]");
    process.exit(1);
  }

  const work = mkdtempSync(path.join(tmpdir(), "ait-gif-"));
  const palette = path.join(work, "palette.png");

  try {
    ffmpeg([
      "-ss", String(start), "-t", String(duration), "-i", SRC,
      "-vf", "fps=12,scale=640:-1:flags=lanczos,palettegen=stats_mode=diff",
      palette,
    ]);
    ffmpeg([
      "-ss", String(start), "-t", String(duration), "-i", SRC,
      "-i", palette,
      "-filter_complex", "fps=12,scale=640:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer",
      OUT,
    ]);
    console.log("Wrote", OUT);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();
