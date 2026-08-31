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

/**
 * The lesson is taught in Hindi and every checkpoint is drawn from the same
 * narrow Chapter 4 (Resistance and Ohm's Law), but the exact question and
 * example the LLM picks varies run to run (e.g. "why is hairdryer wire
 * thin" vs. a direct Ohm's-Law numeric question). A short answer to one
 * specific example scored "Not quite" on a different one in rehearsal, so
 * this is deliberately a comprehensive, Hindi, kitchen-sink answer covering
 * every fact the chapter contains (resistance + wire thickness/length,
 * Ohm's Law itself, and the resistance-up/current-down relationship with a
 * worked number) rather than one narrow example, so it's addressed whatever
 * specific angle the real checkpoint asks about.
 */
const CORRECT_ANSWER =
  "प्रतिरोध (resistance) यह मापता है कि कोई चालक धारा के बहने का कितना विरोध करता है। पतला और लंबा तार मोटे और छोटे तार से ज़्यादा प्रतिरोध देता है — इसीलिए हेयर ड्रायर का हीटिंग एलिमेंट पतले तार से बनाया जाता है, ताकि ज़्यादा प्रतिरोध के कारण ज़्यादा गर्मी पैदा हो। ओम के नियम के अनुसार धारा = वोल्टेज ÷ प्रतिरोध (I = V / R)। अगर वोल्टेज स्थिर रहे और प्रतिरोध बढ़े, तो धारा घटती है, बढ़ती नहीं — उदाहरण के लिए 12 वोल्ट की बैटरी 4 ओम के प्रतिरोधक में 3 एम्पियर धारा देती है, लेकिन 6 ओम के प्रतिरोधक में सिर्फ 2 एम्पियर।";

/**
 * Deliberately embodies the exact misconception the assessment itself uses
 * as its worked example (resistance up → current up, when Ohm's Law says
 * the opposite) — a genuinely false physics claim, so it reliably fails to
 * be marked "Correct" for any resistance/Ohm's-Law checkpoint regardless of
 * the specific example asked.
 */
const WRONG_ANSWER =
  "अगर प्रतिरोध बढ़ता है और वोल्टेज स्थिर रहता है, तो धारा भी बढ़ जाती है, क्योंकि ज़्यादा प्रतिरोध सर्किट में ज़्यादा धारा को धकेलता है।";

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

async function isServerUp(): Promise<boolean> {
  return fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(4000) })
    .then((r) => r.ok)
    .catch(() => false);
}

/**
 * This machine runs several worktrees' dev servers side by side, and this
 * one has been observed getting killed mid-request by something unrelated
 * to this script (a broad "next dev" cleanup elsewhere), losing whatever
 * long-running LLM/render call was in flight. Rather than let that fail the
 * whole recording, retry the per-attempt wait; if it timed out because the
 * server was actually down, wait for it to come back up and replay the
 * triggering action (the client-side page survives — only the in-flight
 * request died) before waiting again.
 */
/** Thrown by an `attemptWait` to mean "this is a real, final answer from the app — stop and
 *  report it," as opposed to an ordinary timeout, which withServerRestartRecovery treats as
 *  either a dead server (recoverable) or a genuinely slow real call (worth another look). */
class FatalError extends Error {}

async function withServerRestartRecovery(
  attemptWait: () => Promise<void>,
  retryTrigger: () => Promise<void>,
  opts: { label: string; totalTimeoutMs: number },
): Promise<void> {
  const deadline = Date.now() + opts.totalTimeoutMs;
  while (Date.now() < deadline) {
    try {
      await attemptWait();
      return;
    } catch (err) {
      if (err instanceof FatalError) throw err;
      if (Date.now() >= deadline) throw err;
      const healthy = await isServerUp();
      if (!healthy) {
        log(`server unreachable during "${opts.label}" — waiting for it to recover`);
        while (!(await isServerUp())) {
          await new Promise((r) => setTimeout(r, 3000));
        }
        log(`server recovered — retrying trigger for "${opts.label}"`);
        await retryTrigger().catch(() => {});
      }
      // Loop again either way: a healthy server just means the real call is still genuinely running.
    }
  }
  throw new Error(`"${opts.label}" did not complete within ${opts.totalTimeoutMs}ms, including any server-restart recovery`);
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
    { timeout: 10 * 60_000 },
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
  // CheckpointQuestion's card has 2 <p>s ("Checkpoint" label, then the prompt);
  // Assessment's quiz card has only 1 (the prompt). .last() is the prompt in both.
  const prompt = (await card.locator("p").last().textContent())?.trim() ?? "";
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
function pickAnswer(
  info: Pick<QuestionCardInfo, "prompt" | "isMcq" | "options">,
  wantCorrect: boolean,
  conceptContext = "",
): string {
  const { isMcq, options } = info;

  if (isMcq) {
    // The lesson is taught in Hindi, so MCQ option text may be Hindi, English, or Hinglish
    // depending on the run — match both scripts' roots for "decrease"/"increase"/"inversely".
    const decreaseIdx = options.findIndex((o) => /decreas|घट|कम हो/i.test(o));
    const increaseIdx = options.findIndex((o) => /increas|बढ़/i.test(o));
    const properIdx = options.findIndex((o) => /invers|proportional|व्युत्क्रम|आनुपातिक/i.test(o));
    if (wantCorrect) {
      if (decreaseIdx >= 0) return options[decreaseIdx];
      if (properIdx >= 0) return options[properIdx];
      return options.find((_, i) => i !== increaseIdx) ?? options[0];
    }
    if (increaseIdx >= 0) return options[increaseIdx];
    return options.find((_, i) => i !== decreaseIdx) ?? options[0];
  }

  if (!wantCorrect) return WRONG_ANSWER;
  // Tried prepending the concept's own LLM-generated summary as extra context (real run,
  // 2026-08-31): it drifted off the source material (asserted a "cost" rationale the fixture
  // never states) and buried the correct physics explanation behind it, scoring "Not quite" on
  // a question the fixed CORRECT_ANSWER alone would have answered directly. The fixed answer is
  // hand-verified against the actual fixture text — more reliable than an unverified paraphrase.
  void conceptContext;
  return CORRECT_ANSWER;
}

/** Fills in an answer (MCQ click or textarea) without submitting — CheckpointQuestion has one
 *  submit button per card, but Assessment's quiz cards share a single "Submit quiz" button below
 *  all of them, so filling and submitting can't be the same step for both. */
async function fillAnswer(card: Locator, info: QuestionCardInfo, wantCorrect: boolean, conceptContext = ""): Promise<string> {
  const answer = pickAnswer(info, wantCorrect, conceptContext);
  if (info.isMcq) {
    const idx = info.options.findIndex((o) => o === answer);
    await card.locator("label").nth(idx < 0 ? 0 : idx).click();
  } else {
    await card.locator("textarea").fill(answer);
  }
  log(`${wantCorrect ? "CORRECT" : "WRONG (deliberate misconception)"} answer: "${answer.slice(0, 80)}..."`);
  return answer;
}

async function submitAnswer(card: Locator, info: QuestionCardInfo, wantCorrect: boolean, conceptContext = "") {
  await fillAnswer(card, info, wantCorrect, conceptContext);
  log("submitting checkpoint answer");
  await card.getByRole("button", { name: /Submit answer/ }).click();
}

/** Answers the currently visible checkpoint, looping through re-explanation(s) if the first answer is deliberately wrong, until the concept is marked correct. */
async function answerCheckpointToCompletion(page: Page, opts: { intendedWrong: boolean; conceptContext?: string }) {
  let lastVideoSrc: string | null = await page.$eval("video", (v) => v.getAttribute("src")).catch(() => null);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const wantCorrect = !opts.intendedWrong || attempt > 1;

    const card = page.locator('div.rounded-xl:has-text("Checkpoint")').last();
    await card.waitFor({ state: "visible", timeout: 6 * 60_000 });
    const info = await readQuestionCard(card);
    log(`checkpoint (attempt ${attempt}): "${info.prompt}"`);
    await submitAnswer(card, info, wantCorrect, opts.conceptContext);

    // FeedbackCard's verdict <p> shares "text-xs font-medium uppercase tracking-wide" with
    // CheckpointQuestion's own "Checkpoint" label and ProgressHeader's "Concept N of M" label —
    // disambiguate with the color class FeedbackCard alone adds (emerald when correct, amber otherwise).
    const feedback = page
      .locator("p.text-xs.font-medium.uppercase.tracking-wide.text-emerald-700, p.text-xs.font-medium.uppercase.tracking-wide.text-amber-700")
      .last();
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
    // Select the JUST-uploaded document by its real id (from the real POST response), never by
    // list position alone: a document row can outlive its uploaded file on disk (e.g. a DB reset
    // that wasn't paired with a data/uploads reset), and outline extraction on such an orphan
    // dead-ends with "no longer available on disk" — indexing still reports it as "ready" since
    // that's chunks already persisted in the DB, not a check that the file still exists.
    const [uploadResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/documents") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Upload" }).click(),
    ]);
    const uploadedDocId: string = (await uploadResponse.json()).document.id;
    log(`uploaded fresh document: ${uploadedDocId}`);
    // The page's own onUploaded callback re-fetches /api/documents and re-renders the list
    // asynchronously; poll the same endpoint until the fresh id actually shows up in it.
    let docIndex = -1;
    for (let i = 0; i < 20 && docIndex < 0; i++) {
      const documentsAtUpload: { id: string }[] = await page.evaluate(() =>
        fetch("/api/documents").then((r) => r.json()).then((d) => d.documents),
      );
      docIndex = documentsAtUpload.findIndex((d) => d.id === uploadedDocId);
      if (docIndex < 0) await page.waitForTimeout(500);
    }
    if (docIndex < 0) throw new Error(`Uploaded document ${uploadedDocId} did not appear in /api/documents.`);
    const docButton = page.locator('section:has-text("Documents") ul button').nth(docIndex);
    await docButton.waitFor({ state: "visible", timeout: 30_000 });
    await docButton.click();
    await setStage(page, "1 · Document indexing", "Local MiniLM embeddings + BM25, real chunk-by-chunk progress");
    await page.locator("text=/— ready\\./").waitFor({ timeout: 90_000 });
    await page.waitForTimeout(1500);
    await setStage(page, "1 · Chapter outline", "Extracting chapters, concepts, and worked examples");
    const outlineSection = page.locator("section", { has: page.getByRole("heading", { name: "Chapter outline" }) });
    const extractOutlineBtn = outlineSection.getByRole("button", { name: /Extract outline|Refresh/ });
    await extractOutlineBtn.click();
    // Real, uncached LLM outline extraction (sarvam-105b spends its budget on reasoning before
    // content — see docs/ARCHITECTURE.md) can run well past 60s. Wait for the outline section
    // itself to settle (populated chapters OR a visible error), not one exact heading string, so
    // a real failure (like the orphan-file dead end above) surfaces as a clear message instead of
    // a generic timeout.
    await withServerRestartRecovery(
      async () => {
        await Promise.race([
          outlineSection.locator("ol li").first().waitFor({ state: "visible", timeout: 60_000 }),
          outlineSection.locator("p.text-red-600").waitFor({ state: "visible", timeout: 60_000 }).then(async () => {
            const errText = await outlineSection.locator("p.text-red-600").textContent();
            throw new FatalError(`Outline extraction failed for document ${uploadedDocId}: ${errText}`);
          }),
        ]);
      },
      () => extractOutlineBtn.click(),
      { label: "outline extraction", totalTimeoutMs: 5 * 60_000 },
    );
    await page.waitForTimeout(4000);

    // ---- 2. Home: upload, free-text instruction, confirm, build the lesson ----
    await page.goto(`${BASE_URL}/`);
    await reinjectBannerAfterNav(page, "2 · Upload & instruction", "A student describes how they want to be taught");
    await uploadFileAndWaitReady(page, FIXTURE_PATH, "text=/Parsing|Parsed/");
    await page.locator("text=/^Parsed/").waitFor({ timeout: 30_000 });
    await page.locator("text=/indexed\\./").waitFor({ timeout: 90_000 }).catch(() => {});
    await page.locator("textarea").fill(INSTRUCTION);
    await page.waitForTimeout(1500);
    const understandBtn = page.getByRole("button", { name: "Understand my request" });
    await understandBtn.click();
    await withServerRestartRecovery(
      () => page.locator("text=Here's what I understood").waitFor({ timeout: 60_000 }),
      () => understandBtn.click(),
      { label: "understand my request", totalTimeoutMs: 4 * 60_000 },
    );
    await setStage(page, "2 · Confirm the lesson", "Level, minutes, language, and depth parsed from free text");
    await page.waitForTimeout(3500);
    const buildLessonBtn = page.getByRole("button", { name: "Looks good — build my lesson" });
    await buildLessonBtn.click();
    await withServerRestartRecovery(
      () => page.waitForURL(/\/learn\//, { timeout: 60_000 }),
      () => buildLessonBtn.click().catch(() => {}), // no-op if it already navigated away
      { label: "build my lesson", totalTimeoutMs: 5 * 60_000 },
    );
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
      const concept = sessionData.plan.concepts[i];
      const conceptTitle: string = concept.title;
      // The concept's own summary is the actual ground truth its checkpoint tests — feeding it
      // into the "correct" answer makes the automated answer robust to whichever specific
      // example/phrasing the real LLM happened to write the checkpoint question around.
      const conceptContext: string = concept.summary ?? "";
      await setStage(page, `4 · Teaching video — concept ${i + 1}/${conceptCount}`, conceptTitle);
      lastVideoSrc = await waitForNextVideoAndAdvance(page, lastVideoSrc, `concept ${i + 1}: ${conceptTitle}`);

      if (i === 0) {
        await setStage(page, "4 · Checkpoint — answered correctly", conceptTitle);
        await answerCheckpointToCompletion(page, { intendedWrong: false, conceptContext });

        await setStage(page, "6 · Off-script interruption", "A grounded follow-up question, mid-lesson");
        await askAnything(page, OFF_SCRIPT_QUESTION, "off-script (grounded)");

        await setStage(page, "7 · Mid-lesson language switch", `"${LANGUAGE_SWITCH_PHRASE}"`);
        await askAnything(page, LANGUAGE_SWITCH_PHRASE, "language switch");

        await setStage(page, "8 · Question the material doesn't cover", "Honest refusal, not a guess");
        await askAnything(page, UNCOVERED_QUESTION, "uncovered question");
      } else if (i === 1) {
        await setStage(page, "5 · Checkpoint — answered WRONG on purpose", conceptTitle);
        await answerCheckpointToCompletion(page, { intendedWrong: true, conceptContext });
      } else {
        await setStage(page, `4 · Checkpoint — concept ${i + 1}/${conceptCount}`, conceptTitle);
        await answerCheckpointToCompletion(page, { intendedWrong: false, conceptContext });
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
      await fillAnswer(card, info, true);
      await page.waitForTimeout(400);
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
