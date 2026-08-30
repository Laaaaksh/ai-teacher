/**
 * "Explain -> Demonstrate -> Question" — turns one planned Concept into the
 * scene beats the lesson player/video slice storyboards: an introduction, an
 * explanation (with a named analogy, so adapt.ts can avoid repeating it), a
 * worked example, a checkpoint question, and a transition.
 *
 * Subject-aware visuals are a deliberate, inspectable decision per the spec
 * ("demonstrate how the system decides"): `chooseVisualKind` is a plain
 * lookup table, not an LLM call, so the kind + the reason it was picked are
 * always the same for the same (subject, beat) pair and can be shown in the
 * UI/docs verbatim. Only the visual's *content* (the actual LaTeX/Mermaid/
 * code) comes from the model, grounded in the concept it's illustrating.
 */
import { z } from "zod";
import { json } from "./llm";
import { languageInstruction } from "./profile";
import type { LearnerProfileRow } from "../db/types";
import type {
  Concept,
  LanguageCode,
  QuestionType,
  SceneType,
  Subject,
  VisualKind,
  VisualRenderer,
  VisualSpec,
} from "../types";

type Beat = "concept-overview" | "introduction" | "explanation" | "example" | "checkpoint" | "transition" | "summary";

interface VisualChoice {
  kind: VisualKind;
  renderer: VisualRenderer;
  rationale: string;
}

const SUBJECT_VISUAL_RULES: Record<Subject, Partial<Record<Beat, VisualChoice>> & { default: VisualChoice }> = {
  mathematics: {
    default: {
      kind: "step-by-step",
      renderer: "katex",
      rationale: "Mathematics is understood by tracing how one line of working leads to the next, not by reading prose about it — a step-by-step derivation lets the learner follow the actual algebra.",
    },
    "concept-overview": {
      kind: "equation",
      renderer: "katex",
      rationale: "The concept is anchored to the single equation that defines it, so the learner has one fixed reference point before the derivation.",
    },
    checkpoint: {
      kind: "equation",
      renderer: "katex",
      rationale: "A checkpoint on a maths concept tests whether the learner can apply the equation itself, so the equation (not the full derivation) is what's shown.",
    },
  },
  physics: {
    default: {
      kind: "diagram",
      renderer: "mermaid",
      rationale: "Physics concepts (forces, circuits, processes) are relationships between physical quantities that are easier to see in a diagram than to infer from a formula alone.",
    },
    example: {
      kind: "equation",
      renderer: "katex",
      rationale: "A worked physics example is plugging real numbers into the governing equation, so the equation with substituted values is the clearest artifact.",
    },
  },
  chemistry: {
    default: {
      kind: "diagram",
      renderer: "mermaid",
      rationale: "Chemical processes and reactions are sequences of state changes, which a process diagram communicates more directly than narration.",
    },
  },
  biology: {
    default: {
      kind: "labelled-diagram",
      renderer: "mermaid",
      rationale: "Biological structures and processes are spatial/sequential — a labelled diagram lets the learner map each term in the narration onto a part of the structure or step of the process.",
    },
  },
  history: {
    default: {
      kind: "timeline",
      renderer: "mermaid",
      rationale: "Historical concepts are fundamentally about sequence and causality between events, which a timeline shows directly instead of forcing the learner to reconstruct order from prose.",
    },
  },
  programming: {
    default: {
      kind: "code",
      renderer: "shiki",
      rationale: "Programming concepts are best demonstrated by real, runnable code plus what it produces, not by describing the code in words.",
    },
    "concept-overview": {
      kind: "architecture-diagram",
      renderer: "mermaid",
      rationale: "Before the code, the learner needs the shape of the system (what calls what) — an architecture diagram gives that map before the detail.",
    },
    introduction: {
      kind: "architecture-diagram",
      renderer: "mermaid",
      rationale: "Before the code, the learner needs the shape of the system (what calls what) — an architecture diagram gives that map before the detail.",
    },
  },
  general: {
    default: {
      kind: "bullets",
      renderer: "html",
      rationale: "The concept doesn't fit a subject-specific visual language, so a concise bulleted breakdown keeps the on-screen text scannable without inventing a diagram the content doesn't support.",
    },
    "concept-overview": {
      kind: "concept-map",
      renderer: "mermaid",
      rationale: "A broad or cross-cutting concept is better shown as how its sub-ideas relate to each other than as a linear list.",
    },
  },
};

/** The deterministic, inspectable half of "choose the visual deliberately" — same (subject, beat) always yields the same kind + reason. */
export function chooseVisualKind(subject: Subject, beat: Beat): VisualChoice {
  const rules = SUBJECT_VISUAL_RULES[subject];
  return rules[beat] ?? rules.default;
}

const RENDERER_SOURCE_FORMAT: Record<VisualRenderer, string> = {
  katex: "LaTeX math source",
  mermaid: "Mermaid diagram syntax",
  shiki: "source code",
  html: "plain HTML",
  svg: "inline SVG markup",
  plotter: "a plot specification",
  image: "an image description",
};

/**
 * Beats of the same concept can land on different renderers (a programming
 * explanation is a diagram, its example is code), so every prompt that asks
 * for visual source has to name the renderer of *that* beat rather than the
 * concept's overview renderer — otherwise Mermaid text gets handed to shiki.
 */
export function renderedAs(renderer: VisualRenderer): string {
  return RENDERER_SOURCE_FORMAT[renderer];
}

// ---------------------------------------------------------------------------
// Scripting one concept into beats
// ---------------------------------------------------------------------------

export interface ScriptedBeat {
  type: SceneType;
  narration: string;
  visual?: VisualSpec;
  estimatedSeconds: number;
  /** Set on explanation/example beats — the specific analogy/approach used, so adapt.ts can track it and never repeat it for this concept. */
  analogyLabel?: string;
}

export interface ScriptedQuestion {
  type: QuestionType;
  prompt: string;
  options?: string[];
  referenceAnswer: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
}

export interface ScriptedConcept {
  beats: ScriptedBeat[];
  question: ScriptedQuestion;
}

const BEAT_TIME_SHARE: Record<"introduction" | "explanation" | "example" | "checkpoint" | "transition", number> = {
  introduction: 0.1,
  explanation: 0.35,
  example: 0.3,
  checkpoint: 0.15,
  transition: 0.1,
};

const ScriptSchema = z.object({
  introductionNarration: z.string(),
  explanationNarration: z.string(),
  explanationAnalogyLabel: z.string(),
  explanationVisualContent: z.string(),
  explanationVisualCaption: z.string(),
  exampleNarration: z.string(),
  exampleVisualContent: z.string(),
  exampleVisualCaption: z.string(),
  transitionNarration: z.string(),
  checkpointQuestion: z.object({
    type: z.enum(["mcq", "short-answer", "problem-solving", "application", "explain-in-own-words"]),
    prompt: z.string(),
    options: z.array(z.string()).nullable(),
    referenceAnswer: z.string(),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  }),
});

export interface ScriptConceptInput {
  concept: Concept;
  learnerProfile: Pick<LearnerProfileRow, "level" | "goal" | "style" | "priorKnowledge">;
  language: LanguageCode;
}

export async function scriptConcept(input: ScriptConceptInput): Promise<ScriptedConcept> {
  const { concept, learnerProfile, language } = input;

  const explanationVisual = chooseVisualKind(concept.subject, "explanation");
  const exampleVisual = chooseVisualKind(concept.subject, "example");
  const checkpointVisual = chooseVisualKind(concept.subject, "checkpoint");

  const grounding = concept.citations.length
    ? `Ground the explanation in this material excerpt(s) — do not contradict them:\n${concept.citations
        .map((c) => `- (${c.section ?? `page ${c.page ?? "?"}`}) ${c.excerpt}`)
        .join("\n")}`
    : "No source material was uploaded for this concept; teach from general knowledge.";

  const script = await json(ScriptSchema, {
    messages: [
      {
        role: "system",
        content:
          `You are an expert ${concept.subject} teacher scripting one beat-by-beat lesson segment for a ${learnerProfile.level} learner. ` +
          `Learner's goal: ${learnerProfile.goal || "general understanding"}. Preferred style: ${learnerProfile.style || "clear and direct"}. ` +
          `Prior knowledge: ${learnerProfile.priorKnowledge || "none stated"}. ` +
          `${languageInstruction(language)} This applies to ALL narration and the checkpoint question. ` +
          "Produce: an introduction line, an explanation with a named analogy distinct from generic phrasing (explanationAnalogyLabel should be a short 3-6 word tag naming the analogy, e.g. 'water pipe analogy for current'), " +
          "a worked example, a transition line into the next concept, and one checkpoint question that tests understanding of THIS concept specifically (not trivia). " +
          `Each visualContent field must be real, renderer-appropriate source (LaTeX for katex, Mermaid syntax for mermaid, source code for shiki, plain HTML/text otherwise) illustrating this concept — not a description of a visual. ` +
          `explanationVisualContent is rendered by "${explanationVisual.renderer}" (${renderedAs(explanationVisual.renderer)}); ` +
          `exampleVisualContent is rendered by "${exampleVisual.renderer}" (${renderedAs(exampleVisual.renderer)}). Write each one for its own renderer, even when the two differ.` +
          `\n\nRespond with ONLY a JSON object of exactly this shape (no other keys, no markdown fences):\n` +
          `{"introductionNarration": string, "explanationNarration": string, "explanationAnalogyLabel": string, "explanationVisualContent": string, "explanationVisualCaption": string, ` +
          `"exampleNarration": string, "exampleVisualContent": string, "exampleVisualCaption": string, "transitionNarration": string, ` +
          `"checkpointQuestion": {"type": one of "mcq"|"short-answer"|"problem-solving"|"application"|"explain-in-own-words", "prompt": string, "options": string[] or null (only for mcq), "referenceAnswer": string, "difficulty": integer 1-5}}`,
      },
      {
        role: "user",
        content: `Concept: ${concept.title}\nSummary: ${concept.summary}\n${grounding}`,
      },
    ],
    temperature: 0.6,
  });

  const seconds = (share: keyof typeof BEAT_TIME_SHARE) =>
    Math.max(5, Math.round(concept.timeBudgetSeconds * BEAT_TIME_SHARE[share]));

  const beats: ScriptedBeat[] = [
    { type: "introduction", narration: script.introductionNarration, estimatedSeconds: seconds("introduction") },
    {
      type: "explanation",
      narration: script.explanationNarration,
      analogyLabel: script.explanationAnalogyLabel,
      visual: {
        kind: explanationVisual.kind,
        renderer: explanationVisual.renderer,
        content: script.explanationVisualContent,
        caption: script.explanationVisualCaption,
        rationale: explanationVisual.rationale,
      },
      estimatedSeconds: seconds("explanation"),
    },
    {
      type: "example",
      narration: script.exampleNarration,
      visual: {
        kind: exampleVisual.kind,
        renderer: exampleVisual.renderer,
        content: script.exampleVisualContent,
        caption: script.exampleVisualCaption,
        rationale: exampleVisual.rationale,
      },
      estimatedSeconds: seconds("example"),
    },
    {
      type: "checkpoint",
      narration: script.checkpointQuestion.prompt,
      visual: {
        kind: checkpointVisual.kind,
        renderer: checkpointVisual.renderer,
        content: script.explanationVisualContent,
        rationale: checkpointVisual.rationale,
      },
      estimatedSeconds: seconds("checkpoint"),
    },
    { type: "transition", narration: script.transitionNarration, estimatedSeconds: seconds("transition") },
  ];

  return {
    beats,
    question: {
      type: script.checkpointQuestion.type,
      prompt: script.checkpointQuestion.prompt,
      options: script.checkpointQuestion.options ?? undefined,
      referenceAnswer: script.checkpointQuestion.referenceAnswer,
      difficulty: script.checkpointQuestion.difficulty,
    },
  };
}

// ---------------------------------------------------------------------------
// Lesson-level summary (once, at the end of the plan)
// ---------------------------------------------------------------------------

const SummarySchema = z.object({ narration: z.string() });

export async function scriptLessonSummary(input: {
  topic: string;
  concepts: Concept[];
  learnerProfile: Pick<LearnerProfileRow, "level">;
  language: LanguageCode;
}): Promise<ScriptedBeat> {
  const { narration } = await json(SummarySchema, {
    messages: [
      {
        role: "system",
        content:
          `Write a short (3-5 sentence) closing summary for a ${input.learnerProfile.level} learner who just finished a lesson on "${input.topic}". ${languageInstruction(input.language)} ` +
          "Recap the concepts covered in order and say what comes next (a quick assessment). " +
          `Respond with ONLY a JSON object of exactly this shape: {"narration": string}`,
      },
      { role: "user", content: `Concepts covered, in order: ${input.concepts.map((c) => c.title).join(", ")}` },
    ],
  });

  return { type: "summary", narration, estimatedSeconds: 30 };
}
