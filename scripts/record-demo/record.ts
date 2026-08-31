/**
 * Drives the real, running AI Teacher app through the exact scenario the
 * assessment itself describes — upload a chapter, "Teach me Chapter 4 in 20
 * minutes, in Hindi, ask me questions and test me at the end" — and records
 * it with Playwright. Nothing here is mocked: it talks to a real `next
 * start` server backed by a real SARVAM_API_KEY, so every LLM call, TTS
 * call, and video render is genuine. See docs/DEMO.md for how the recorded
 * output is cut into docs/assets/demo.mp4 / demo.gif.
 *
 * The DOM is real (no screenshots stitched together), but the automation
 * takes one honest shortcut: instead of sitting through a rendered scene's
 * full real-time playback inside headless Chromium, it dispatches a real
 * `ended` event on the `<video>` element once the app reports the render
 * job complete — the same event the browser fires natively, just not after
 * literally waiting out the clip. The actual generated MP4 (with its real
 * Sarvam narration audio, which Playwright's silent frame-capture wouldn't
 * carry anyway) is separately downloaded via its own `/api/video/:id/download`
 * URL and spliced into the final cut for real, in full, with audio — see
 * postprocess.sh. Every wait for indexing, planning, scripting, answer
 * evaluation, and quiz grading is a real wait on a real API call.
 *
 * Usage: npx tsx scripts/record-demo/record.ts
 * Requires: `npm run build && npm run start` (or `npm run dev`) already
 * running at DEMO_BASE_URL (default http://localhost:3000), and a fresh
 * `data/ai-teacher.sqlite` for a clean run (a stale learner profile in
 * localStorage would resume old progress instead of starting fresh).
 */
import { chromium, type Page, type Locator } from "playwright";
import { mkdirSync, writeFileSync, createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const BASE_URL = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const FIXTURE_PATH = path.join(__dirname, "fixtures", "demo-textbook.pdf");
const OUTPUT_DIR = path.join(__dirname, "output");
const VIDEO_DIR = path.join(OUTPUT_DIR, "raw-video");
const CLIPS_DIR = path.join(OUTPUT_DIR, "clips");

const INSTRUCTION =
  "I am a beginner. Teach me Chapter 4 in 20 minutes. Explain it in Hindi using simple examples. Ask me questions during the lesson and test me at the end.";

const OFF_SCRIPT_QUESTION = "Why is a hairdryer's heating element a thin coiled wire instead of a thick one?";
const LANGUAGE_SWITCH_PHRASE = "ab hindi mein samjhao";
const UNCOVERED_QUESTION = "What is the boiling point of mercury?";

const CORRECT_ANSWER =
  "Ohm's Law says current equals voltage divided by resistance, I = V / R. If the voltage stays the same and the resistance goes up, the current goes DOWN, not up. For example a 12 volt battery across a 4 ohm resistor gives 3 amperes, but across a 6 ohm resistor it only gives 2 amperes.";

const WRONG_ANSWER =
  "If the resistance increases while the voltage stays the same, the current also increases, because more resistance pushes more current through the circuit.";

interface TimelineEvent {
  t: number;
  label: string;
}

interface VideoManifestEntry {
  label: string;
  src: string;
}

const timeline: TimelineEvent[] = [];
const videoManifest: VideoManifestEntry[] = [];
let startTime = 0;

function log(label: string) {
  const t = Date.now() - startTime;
  timeline.push({ t, label });
  console.log(`[${(t / 1000).toFixed(1)}s] ${label}`);
}

async function setStage(page: Page, title: string, detail = "") {
  await page.evaluate(
    ({ title, detail }: { title: string; detail: string }) => {
      let el = document.getElementById("__demo_banner");
      if (!el) {
        el = document.createElement("div");
        el.id = "__demo_banner";
        el.style.cssText =
          "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#0a0a0a;color:#fff;" +
          "padding:10px 22px;font:600 15px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;" +
          "display:flex;justify-content:space-between;align-items:center;box-shadow:0 2px 10px rgba(0,0,0,.35)";
        const title_ = document.createElement("span");
        title_.id = "__demo_banner_title";
        const detail_ = document.createElement("span");
        detail_.id = "__demo_banner_detail";
        detail_.style.cssText = "opacity:.65;font-weight:400;margin-left:16px";
        el.appendChild(title_);
        el.appendChild(detail_);
        document.documentElement.appendChild(el);
        document.body.style.paddingTop = "46px";
      }
      document.getElementById("__demo_banner_title")!.textContent = title;
      document.getElementById("__demo_banner_detail")!.textContent = detail;
    },
    { title, detail },
  );
  log(`STAGE: ${title}${detail ? " — " + detail : ""}`);
}

async function reinjectBannerAfterNav(page: Page, title: string, detail = "") {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400); // hydration buffer — React attaches handlers just after networkidle
  await setStage(page, title, detail);
}

/** Waits for a `<video>` with a src different from `previousSrc`, records it, then fast-forwards the app past it with a real `ended` event (see file header). */
async function waitForNextVideoAndAdvance(page: Page, previousSrc: string | null, label: string): Promise<string> {
  await page.waitForFunction(
    (prev) => {
      const v = document.querySelector("video");
      return !!(v && v.getAttribute("src") && v.getAttribute("src") !== prev);
    },
    previousSrc,
    { timeout: 6 * 60_000 },
  );
  const src = await page.$eval("video", (v) => v.getAttribute("src")!);
  log(`video ready: ${label} (${src})`);
  videoManifest.push({ label, src });
  // Let a couple of real frames render/paint before we fast-forward past it.
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const v = document.querySelector("video");
    if (v) v.dispatchEvent(new Event("ended"));
  });
  return src;
}

interface QuestionCardInfo {
  card: Locator;
  prompt: string;
  isMcq: boolean;
  options: string[];
}

async function readQuestionCard(card: Locator): Promise<QuestionCardInfo> {
  const prompt = (await card.locator("p").nth(1).textContent())?.trim() ?? "";
  const optionLocators = card.locator("label");
  const count = await optionLocators.count();
  const options: string[] = [];
  for (let i = 0; i < count; i++) {
    options.push((await optionLocators.nth(i).textContent())?.trim() ?? "");
  }
  return { card, prompt, isMcq: count > 0, options };
}

/**
 * Every concept in this lesson is drawn from the same resistance/Ohm's-Law
 * chapter (the fixture scopes the whole document to it), so a fixed
 * correct/wrong pair of physics answers is a reliable, deterministic way to
 * demonstrate a genuine correct checkpoint and a genuine misconception —
 * this isn't a canned transcript, it's a real student answer submitted to
 * the real evaluator, which decides the verdict on its own.
 */
function pickAnswer(info: Pick<QuestionCardInfo, "prompt" | "isMcq" | "options">, wantCorrect: boolean): string {
  const { isMcq, options } = info;

  if (isMcq) {
    const decreaseIdx = options.findIndex((o) => /decreas/i.test(o));
    const increaseIdx = options.findIndex((o) => /increas/i.test(o));
    const properIdx = options.findIndex((o) => /invers|proportional/i.test(o));
    if (wantCorrect) {
      if (decreaseIdx >= 0) return options[decreaseIdx];
      if (properIdx >= 0) return options[properIdx];
      return options.find((_, i) => i !== increaseIdx) ?? options[0];
    }
    if (increaseIdx >= 0) return options[increaseIdx];
    return options.find((_, i) => i !== decreaseIdx) ?? options[0];
  }

  return wantCorrect ? CORRECT_ANSWER : WRONG_ANSWER;
}

async function submitAnswer(card: Locator, info: QuestionCardInfo, wantCorrect: boolean) {
  const answer = pickAnswer(info, wantCorrect);
  if (info.isMcq) {
    const idx = info.options.findIndex((o) => o === answer);
    await card.locator("label").nth(idx < 0 ? 0 : idx).click();
  } else {
    await card.locator("textarea").fill(answer);
  }
  log(`submitting ${wantCorrect ? "CORRECT" : "WRONG (deliberate misconception)"} answer: "${answer.slice(0, 80)}..."`);
  await card.getByRole("button", { name: /Submit answer/ }).click();
}

/** Answers the currently visible checkpoint, looping through re-explanation(s) if the first answer is deliberately wrong, until the concept is marked correct. */
async function answerCheckpointToCompletion(page: Page, opts: { intendedWrong: boolean }) {
  let lastVideoSrc: string | null = await page.$eval("video", (v) => v.getAttribute("src")).catch(() => null);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const wantCorrect = !opts.intendedWrong || attempt > 1;

    const card = page.locator('div.rounded-xl:has-text("Checkpoint")').last();
    await card.waitFor({ state: "visible", timeout: 6 * 60_000 });
    const info = await readQuestionCard(card);
    log(`checkpoint (attempt ${attempt}): "${info.prompt}"`);
    await submitAnswer(card, info, wantCorrect);

    const feedback = page.locator("p.text-xs.font-medium.uppercase.tracking-wide").last();
    await feedback.waitFor({ state: "visible", timeout: 3 * 60_000 });
    const verdict = (await feedback.textContent())?.trim() ?? "";
    log(`evaluated as: "${verdict}"`);

    if (/^Correct$/i.test(verdict)) {
      await page.getByRole("button", { name: "Continue →" }).click();
      return;
    }

    // Wrong or partial: show the misconception + adaptation, then watch the re-explanation and answer the follow-up.
    const misconceptionLabel = page.locator("text=What's actually going on");
    if (await misconceptionLabel.count()) {
      await page.waitForTimeout(2500); // let the misconception card breathe on screen
    }
    if (attempt >= 3) {
      // Bounded retries — accept whatever's on screen and move on rather than looping forever.
      await page.getByRole("button", { name: /Continue →|See the re-explanation →/ }).click();
      return;
    }
    await page.getByRole("button", { name: "See the re-explanation →" }).click();
    lastVideoSrc = await waitForNextVideoAndAdvance(page, lastVideoSrc, `adaptation re-explanation (attempt ${attempt})`);
  }
}

async function askAnything(page: Page, question: string, label: string) {
  const openButton = page.getByRole("button", { name: "Ask a question" });
  if (await openButton.isVisible().catch(() => false)) {
    await openButton.click();
  }
  const input = page.getByPlaceholder("Ask a question…");
  await input.waitFor({ state: "visible" });
  await input.fill(question);
  log(`ask anything (${label}): "${question}"`);
  await page.getByRole("button", { name: "Send" }).click();
  // Wait for a new history entry to render (the question text appears once answered).
  await page.locator("p.font-medium.text-neutral-900", { hasText: question.slice(0, 30) }).last().waitFor({ timeout: 150_000 });
  await page.waitForTimeout(2500);
}

/**
 * setInputFiles fires real DOM input/change events, but if it runs before
 * Next.js finishes hydrating this page, React's onChange handler isn't
 * attached yet and the file selection is silently lost (the upload button
 * stays disabled forever). Retries the selection until a ready signal
 * (the button becoming enabled) confirms React actually saw it.
 */
async function uploadFileAndWaitReady(page: Page, filePath: string, readySelector: string) {
  const input = page.locator('input[type="file"]');
  await input.waitFor({ state: "attached" });
  for (let attempt = 1; attempt <= 5; attempt++) {
    await input.setInputFiles(filePath);
    const ready = await page
      .waitForSelector(readySelector, { timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    if (ready) return;
    await page.waitForTimeout(600);
  }
  throw new Error(`File upload never became ready (selector: ${readySelector})`);
}

async function downloadVideo(entry: VideoManifestEntry, index: number) {
  const url = entry.src.startsWith("http") ? entry.src : `${BASE_URL}${entry.src}`;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to download ${url}: ${res.status}`);
  const safeLabel = entry.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const outPath = path.join(CLIPS_DIR, `${String(index).padStart(2, "0")}-${safeLabel}.mp4`);
  await pipeline(Readable.fromWeb(res.body as import("stream/web").ReadableStream), createWriteStream(outPath));
  log(`downloaded real generated video: ${outPath}`);
  return outPath;
}

async function main() {
  mkdirSync(VIDEO_DIR, { recursive: true });
  mkdirSync(CLIPS_DIR, { recursive: true });
  startTime = Date.now();

  const health = await fetch(`${BASE_URL}/api/health`).catch(() => null);
  if (!health || !health.ok) {
    throw new Error(`Server not reachable at ${BASE_URL} — run "npm run build && npm run start" first.`);
  }

  const browser = await chromium.launch({
    headless: process.env.DEMO_HEADFUL !== "1",
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  try {
    // ---- 1. Document indexing + parsed chapter outline (/rag-demo) ----
    await page.goto(`${BASE_URL}/rag-demo`);
    await reinjectBannerAfterNav(page, "1 · Document indexing", "Uploading the real Chapter 4 textbook PDF");
    await uploadFileAndWaitReady(page, FIXTURE_PATH, 'button:has-text("Upload"):not([disabled])');
    await page.getByRole("button", { name: "Upload" }).click();
    const docButton = page.locator('section:has-text("Documents") ul button').first();
    await docButton.waitFor({ state: "visible", timeout: 30_000 });
    await docButton.click();
    await setStage(page, "1 · Document indexing", "Local MiniLM embeddings + BM25, real chunk-by-chunk progress");
    await page.locator("text=/— ready\\./").waitFor({ timeout: 90_000 });
    await page.waitForTimeout(1500);
    await setStage(page, "1 · Chapter outline", "Extracting chapters, concepts, and worked examples");
    await page.getByRole("button", { name: "Extract outline" }).click();
    // Real, uncached LLM outline extraction (sarvam-105b spends its budget on
    // reasoning before content — see docs/ARCHITECTURE.md) can run well past 60s.
    await page.locator("text=Chapter 4").waitFor({ timeout: 180_000 });
    await page.waitForTimeout(4000);

    // ---- 2. Home: upload, free-text instruction, confirm, build the lesson ----
    await page.goto(`${BASE_URL}/`);
    await reinjectBannerAfterNav(page, "2 · Upload & instruction", "A student describes how they want to be taught");
    await uploadFileAndWaitReady(page, FIXTURE_PATH, "text=/Parsing|Parsed/");
    await page.locator("text=/^Parsed/").waitFor({ timeout: 30_000 });
    await page.locator("text=/indexed\\./").waitFor({ timeout: 90_000 }).catch(() => {});
    await page.locator("textarea").fill(INSTRUCTION);
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Understand my request" }).click();
    await page.locator("text=Here's what I understood").waitFor({ timeout: 120_000 });
    await setStage(page, "2 · Confirm the lesson", "Level, minutes, language, and depth parsed from free text");
    await page.waitForTimeout(3500);
    await page.getByRole("button", { name: "Looks good — build my lesson" }).click();
    await page.waitForURL(/\/learn\//, { timeout: 180_000 });
    const sessionId = new URL(page.url()).pathname.split("/").pop()!;
    log(`session created: ${sessionId}`);

    // ---- 3. Lesson plan: concepts, time budget, visual + rationale per concept ----
    await reinjectBannerAfterNav(page, "3 · Lesson plan", "Concepts, order, time budget, and the visual chosen per concept");
    await page.locator("text=Lesson plan").first().waitFor({ timeout: 60_000 });
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(1400);
    }
    const startButton = page.getByRole("button", { name: "Start the lesson" });
    await startButton.waitFor({ timeout: 3 * 60_000 });
    await page.waitForTimeout(1000);
    await startButton.click();

    const sessionRes = await fetch(`${BASE_URL}/api/teach/sessions/${sessionId}`);
    const sessionData = await sessionRes.json();
    const conceptCount: number = sessionData.plan.concepts.length;
    log(`plan has ${conceptCount} concepts`);

    // ---- 4-8. Teaching loop: video playback, checkpoints, adaptation, interruptions ----
    let lastVideoSrc: string | null = null;
    for (let i = 0; i < conceptCount; i++) {
      const conceptTitle: string = sessionData.plan.concepts[i].title;
      await setStage(page, `4 · Teaching video — concept ${i + 1}/${conceptCount}`, conceptTitle);
      lastVideoSrc = await waitForNextVideoAndAdvance(page, lastVideoSrc, `concept ${i + 1}: ${conceptTitle}`);

      if (i === 0) {
        await setStage(page, "4 · Checkpoint — answered correctly", conceptTitle);
        await answerCheckpointToCompletion(page, { intendedWrong: false });

        await setStage(page, "6 · Off-script interruption", "A grounded follow-up question, mid-lesson");
        await askAnything(page, OFF_SCRIPT_QUESTION, "off-script (grounded)");

        await setStage(page, "7 · Mid-lesson language switch", `"${LANGUAGE_SWITCH_PHRASE}"`);
        await askAnything(page, LANGUAGE_SWITCH_PHRASE, "language switch");

        await setStage(page, "8 · Question the material doesn't cover", "Honest refusal, not a guess");
        await askAnything(page, UNCOVERED_QUESTION, "uncovered question");
      } else if (i === 1) {
        await setStage(page, "5 · Checkpoint — answered WRONG on purpose", conceptTitle);
        await answerCheckpointToCompletion(page, { intendedWrong: true });
      } else {
        await setStage(page, `4 · Checkpoint — concept ${i + 1}/${conceptCount}`, conceptTitle);
        await answerCheckpointToCompletion(page, { intendedWrong: false });
      }

      // Refresh the video src baseline in case a re-explanation ran (answerCheckpointToCompletion advances it internally too).
      lastVideoSrc = await page.$eval("video", (v) => v.getAttribute("src")).catch(() => lastVideoSrc);
    }

    // Summary/outro clip, if the plan has one, then straight into assessment.
    await setStage(page, "9 · Wrapping up", "Final summary clip");
    await waitForNextVideoAndAdvance(page, lastVideoSrc, "lesson summary").catch(() => log("no separate summary clip"));

    // ---- 9. Final quiz + learning report ----
    await setStage(page, "9 · Final quiz", "Drawn from concepts actually taught, weighted toward what was missed");
    await page.locator("text=Final check").waitFor({ timeout: 3 * 60_000 });
    await page.waitForTimeout(1500);
    const quizCards = page.locator('main div.rounded-xl:has(textarea), main div.rounded-xl:has(input[type="radio"])');
    const quizCount = await quizCards.count();
    for (let i = 0; i < quizCount; i++) {
      const card = quizCards.nth(i);
      const info = await readQuestionCard(card);
      await submitAnswer(card, info, true);
    }
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: "Submit quiz" }).click();
    await page.locator("text=Final score").waitFor({ timeout: 3 * 60_000 });
    await setStage(page, "9 · Learning report", "Score, weak areas, misconceptions, and what to revise next");
    await page.waitForTimeout(5000);

    // ---- 10. Progress dashboard ----
    await page.getByRole("link", { name: "View progress" }).click();
    await reinjectBannerAfterNav(page, "10 · Progress dashboard", "This session recorded against the learner profile");
    await page.locator("text=Your progress").waitFor({ timeout: 30_000 });
    await page.locator("text=Concept mastery").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(5000);

    log("recording complete");
  } finally {
    writeFileSync(path.join(OUTPUT_DIR, "timeline.json"), JSON.stringify(timeline, null, 2));
    writeFileSync(path.join(OUTPUT_DIR, "video-manifest.json"), JSON.stringify(videoManifest, null, 2));
    await page.waitForTimeout(1000);
    const video = page.video();
    await context.close();
    await browser.close();
    const savedPath = video ? await video.path() : null;
    console.log("Raw screen recording:", savedPath);
    console.log("Downloading real generated video clips referenced during the run...");
    for (let i = 0; i < videoManifest.length; i++) {
      await downloadVideo(videoManifest[i], i).catch((err) => console.error(`Failed to download clip ${i}:`, err));
    }
    console.log("Done. See scripts/record-demo/output/ for the raw recording, real video clips, and timeline.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
