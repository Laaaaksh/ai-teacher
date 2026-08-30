/**
 * Seeds a real mixed-subject lesson plan (math derivation, code + output,
 * a history timeline, a wrap-up) and renders it through the real pipeline —
 * real Sarvam TTS, real Chromium frame capture, real ffmpeg mux. Used to
 * manually verify the video-generation slice end to end; not part of the
 * automated test suite (it costs real TTS calls and takes real render time).
 *
 * Run with: npx tsx scripts/demo-lesson.ts
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  createLearnerProfile,
  createLessonPlan,
  createLessonSession,
  createScenes,
} from "../lib/db";
import type { Concept, Scene } from "../lib/types";
import { renderLessonVideo } from "../lib/video/render";

async function main() {
  const profile = createLearnerProfile({
    name: "Demo Learner",
    level: "beginner",
    priorKnowledge: "Knows basic algebra and has seen a for-loop before.",
    goal: "Understand quadratic equations well enough to code and explain them.",
    style: "example-driven",
    language: "en-IN",
    minutesAvailable: 10,
    depth: "standard",
  });

  const session = createLessonSession({
    learnerProfileId: profile.id,
    topic: "Quadratic Equations: Math, Code, and a Little History",
    language: "en-IN",
    totalMinutes: 10,
    depth: "standard",
  });

  const mathConceptId = randomUUID();
  const codeConceptId = randomUUID();
  const historyConceptId = randomUUID();
  const summaryConceptId = randomUUID();

  const concepts: Concept[] = [
    {
      id: mathConceptId,
      title: "Solving with the Quadratic Formula",
      summary: "Deriving x from ax^2+bx+c=0 step by step.",
      subject: "mathematics",
      difficulty: 2,
      prerequisiteConceptIds: [],
      timeBudgetSeconds: 90,
      citations: [],
      visual: {
        kind: "step-by-step",
        renderer: "katex",
        rationale: "A worked algebraic derivation is clearest as sequential equation steps, not a diagram.",
        content: JSON.stringify({
          steps: ["ax^2 + bx + c = 0", "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}", "\\text{For } x^2 - 5x + 6 = 0: \\; a=1, b=-5, c=6"],
          final: "x = \\frac{5 \\pm \\sqrt{25 - 24}}{2} = 3 \\text{ or } 2",
        }),
      },
    },
    {
      id: codeConceptId,
      title: "Implementing It in Python",
      summary: "Turning the formula into a small, runnable function.",
      subject: "programming",
      difficulty: 2,
      prerequisiteConceptIds: [mathConceptId],
      timeBudgetSeconds: 75,
      citations: [],
      visual: {
        kind: "code",
        renderer: "shiki",
        rationale: "Code with its execution output shows the formula actually working, not just described.",
        content: JSON.stringify({
          language: "python",
          code: "import math\n\ndef solve_quadratic(a, b, c):\n    d = b**2 - 4*a*c\n    root = math.sqrt(d)\n    return (-b + root) / (2*a), (-b - root) / (2*a)\n\nprint(solve_quadratic(1, -5, 6))",
          output: "(3.0, 2.0)",
        }),
      },
    },
    {
      id: historyConceptId,
      title: "A Short History of Algebra",
      summary: "From Babylonian tablets to al-Khwarizmi to modern notation.",
      subject: "history",
      difficulty: 1,
      prerequisiteConceptIds: [],
      timeBudgetSeconds: 60,
      citations: [],
      visual: {
        kind: "timeline",
        renderer: "mermaid",
        rationale: "A timeline is the natural shape for a sequence of historical milestones.",
        content: `timeline
    title A Short History of Algebra
    1800 BCE : Babylonian clay tablets solve quadratics geometrically
    820 CE : Al-Khwarizmi writes Al-Jabr, naming the field
    1545 : Cardano publishes the cubic and quartic formulas
    1637 : Descartes introduces modern algebraic notation`,
      },
    },
    {
      id: summaryConceptId,
      title: "What to Remember",
      summary: "Wrap-up bullets tying the lesson together.",
      subject: "general",
      difficulty: 1,
      prerequisiteConceptIds: [mathConceptId, codeConceptId, historyConceptId],
      timeBudgetSeconds: 40,
      citations: [],
      visual: {
        kind: "bullets",
        renderer: "html",
        rationale: "A short recap is best as scannable bullets, not another diagram.",
        content: JSON.stringify([
          "The quadratic formula solves any ax^2+bx+c=0.",
          "The same formula becomes a five-line Python function.",
          "Algebra's notation took nearly 3,500 years to reach its modern form.",
        ]),
      },
    },
  ];

  const plan = createLessonPlan({
    lessonSessionId: session.id,
    learnerProfileId: profile.id,
    topic: session.topic,
    language: "en-IN",
    totalMinutes: 10,
    depth: "standard",
    concepts,
  });

  const scenes: Omit<Scene, "id">[] = [
    {
      lessonPlanId: plan.id,
      conceptId: mathConceptId,
      type: "explanation",
      order: 0,
      narration:
        "Let's solve a quadratic equation. Any equation of the form a x squared plus b x plus c equals zero can be solved with one formula. Watch how it applies to x squared minus five x plus six equals zero: first we write the general equation, then the formula itself, then plug in a equals one, b equals negative five, and c equals six, giving us the two roots, three and two.",
      estimatedSeconds: 22,
      visual: concepts.find((c) => c.id === mathConceptId)!.visual,
    },
    {
      lessonPlanId: plan.id,
      conceptId: codeConceptId,
      type: "example",
      order: 1,
      narration:
        "Now let's turn that formula into code. This small Python function takes a, b, and c, computes the discriminant, and returns both roots. Running it with one, negative five, and six gives exactly what we calculated by hand: three point zero and two point zero.",
      estimatedSeconds: 18,
      visual: concepts.find((c) => c.id === codeConceptId)!.visual,
    },
    {
      lessonPlanId: plan.id,
      conceptId: historyConceptId,
      type: "explanation",
      order: 2,
      narration:
        "This idea is old. Babylonian mathematicians were solving quadratics geometrically almost four thousand years ago. Centuries later, al-Khwarizmi's book Al-Jabr gave the field its name. Cardano extended these methods to cubic equations, and Descartes gave us the symbolic notation we still use today.",
      estimatedSeconds: 20,
      visual: concepts.find((c) => c.id === historyConceptId)!.visual,
    },
    {
      lessonPlanId: plan.id,
      conceptId: summaryConceptId,
      type: "summary",
      order: 3,
      narration:
        "To recap: the quadratic formula solves any equation of this shape, that same formula is just a few lines of code, and the notation we used today took thousands of years to develop.",
      estimatedSeconds: 14,
      visual: concepts.find((c) => c.id === summaryConceptId)!.visual,
    },
  ];

  createScenes(scenes);

  console.log(`Seeded lesson plan ${plan.id} with ${scenes.length} scenes.`);

  const outputPath = path.join(process.cwd(), "data", "video-cache", "output", "demo-lesson.mp4");
  const result = await renderLessonVideo(plan.id, outputPath, {
    onProgress: (p) => console.log(`[${p.stage}] ${p.percent}% — ${p.detail}`),
  });

  console.log(`Rendered ${result.sceneCount} scenes -> ${result.outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
