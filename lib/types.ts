/**
 * Shared domain contracts for AI Teacher.
 *
 * These types model the teaching loop from docs/ARCHITECTURE.md:
 *
 *   Understand -> Plan -> Explain -> Demonstrate -> Question -> Evaluate -> Adapt -> Continue
 *
 * Every later slice (lesson planner, lesson player, video generation, RAG,
 * assessment) codes against these shapes. Treat this file as the seam between
 * slices: changing a field here changes what every other slice can rely on.
 *
 * DB row shapes (lib/db) are separate and persist a superset of this data
 * (ids, timestamps, foreign keys) — accessors translate between rows and
 * these domain types.
 */

// ---------------------------------------------------------------------------
// Learner profile
// ---------------------------------------------------------------------------

export type LearnerLevel = "beginner" | "intermediate" | "advanced";

/** Depth requested for a lesson, independent of the time available. */
export type LearningDepth = "overview" | "standard" | "deep";

/**
 * BCP-47-ish language tags used across chat, TTS and translate. Sarvam's
 * translate endpoint wants codes like "en-IN" / "hi-IN"; the chat/TTS
 * prompts use the same tag so one profile field drives every call.
 * "hinglish" is not a Sarvam language code — it is handled as English text
 * with Hindi code-switching instructions to the chat model, never sent to
 * /translate as a target.
 */
export type LanguageCode =
  | "en-IN"
  | "hi-IN"
  | "hinglish"
  | "bn-IN"
  | "ta-IN"
  | "te-IN"
  | "mr-IN"
  | "kn-IN"
  | "gu-IN"
  | "ml-IN"
  | "pa-IN";

export interface LearnerProfile {
  id: string;
  /** Free-text display name; not used for auth. */
  name: string;
  level: LearnerLevel;
  /** What the learner already knows, in their own words or as tags. */
  priorKnowledge: string;
  /** What the learner wants out of the lesson, e.g. "pass a Class 10 exam". */
  goal: string;
  /** Preferred teaching style, e.g. "analogy-heavy", "example-driven", "formal". */
  style: string;
  language: LanguageCode;
  /** Minutes available for this session; drives lesson plan depth/length. */
  minutesAvailable: number;
  depth: LearningDepth;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Subject-aware visuals
// ---------------------------------------------------------------------------

/** Subject classification the planner assigns to each concept. */
export type Subject =
  | "mathematics"
  | "physics"
  | "biology"
  | "chemistry"
  | "history"
  | "programming"
  | "general";

/** Kind of visual chosen for a concept/scene — an explicit, inspectable decision. */
export type VisualKind =
  | "equation"
  | "graph"
  | "step-by-step"
  | "diagram"
  | "labelled-diagram"
  | "timeline"
  | "map"
  | "code"
  | "architecture-diagram"
  | "concept-map"
  | "comparison-table"
  | "image"
  | "bullets";

/** Renderer that turns a VisualSpec into pixels. */
export type VisualRenderer = "katex" | "mermaid" | "plotter" | "shiki" | "svg" | "html" | "image";

/**
 * A subject-aware visual decision plus the content needed to render it.
 * `content` is renderer-specific (e.g. LaTeX source for katex, Mermaid
 * source for mermaid, source code + language for shiki). Keeping it as a
 * string keeps this type stable while renderers evolve.
 */
export interface VisualSpec {
  kind: VisualKind;
  renderer: VisualRenderer;
  /** Renderer-specific source, e.g. LaTeX, Mermaid syntax, code, or an image URL/data URI. */
  content: string;
  /** Human-readable caption shown under the visual (also an accessibility win). */
  caption?: string;
  /** Why this visual kind was chosen for this concept — shown in the UI/docs per the spec's "don't hand-wave this" requirement. */
  rationale: string;
}

// ---------------------------------------------------------------------------
// Citations (RAG grounding)
// ---------------------------------------------------------------------------

/** A pointer back to the exact source location a claim/answer is grounded in. */
export interface Citation {
  documentId: string;
  chunkId: string;
  /** 1-indexed page number, when the source format has pages (PDF). */
  page?: number;
  /** Section/slide/heading title, when the source format has sections (DOCX/PPTX/MD). */
  section?: string;
  /** Short excerpt shown to the learner so the citation is verifiable at a glance. */
  excerpt: string;
}

// ---------------------------------------------------------------------------
// Concepts and lesson plans
// ---------------------------------------------------------------------------

export interface Concept {
  id: string;
  title: string;
  /** One-paragraph summary of what this concept covers. */
  summary: string;
  subject: Subject;
  /** 1 (foundational) to 5 (advanced), relative to the learner's level. */
  difficulty: 1 | 2 | 3 | 4 | 5;
  /** IDs of concepts that should be understood before this one. */
  prerequisiteConceptIds: string[];
  /** Seconds allotted to this concept, derived from the lesson's total time budget. */
  timeBudgetSeconds: number;
  visual: VisualSpec;
  /** Citations into uploaded material this concept is grounded in, if any. Empty when the lesson is topic-only (no upload). */
  citations: Citation[];
}

/**
 * A structured lesson plan: ordered concepts with a time budget per concept.
 * Duration changes structure, not just length — a 5-minute plan should have
 * fewer, coarser concepts than a 60-minute plan on the same material, and a
 * multi-day request should produce a LearningPath (below) instead of a
 * single LessonPlan.
 */
export interface LessonPlan {
  id: string;
  learnerProfileId: string;
  /** The topic or chapter this plan teaches, in plain language. */
  topic: string;
  /** Source document, when the plan was built from uploaded material. */
  sourceDocumentId?: string;
  language: LanguageCode;
  totalMinutes: number;
  depth: LearningDepth;
  concepts: Concept[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Scenes (the taught lesson, concept by concept)
// ---------------------------------------------------------------------------

export type SceneType = "introduction" | "explanation" | "example" | "checkpoint" | "transition" | "summary";

/**
 * One beat of the taught lesson. Each concept expands into one or more
 * explanation/example scenes plus at least one checkpoint scene carrying a
 * question. Scenes are the unit the video-generation slice storyboards and
 * the unit the lesson-player slice steps through.
 */
export interface Scene {
  id: string;
  lessonPlanId: string;
  conceptId: string;
  type: SceneType;
  order: number;
  /** What the avatar says, in the lesson's language. */
  narration: string;
  visual?: VisualSpec;
  /** Present when type === "checkpoint". */
  questionId?: string;
  estimatedSeconds: number;
}

// ---------------------------------------------------------------------------
// Questions, answers, evaluation, misconceptions
// ---------------------------------------------------------------------------

export type QuestionType =
  | "mcq"
  | "short-answer"
  | "problem-solving"
  | "application"
  | "explain-in-own-words";

export interface Question {
  id: string;
  conceptId: string;
  sceneId?: string;
  type: QuestionType;
  prompt: string;
  /** Present for type === "mcq". */
  options?: string[];
  /** Correct option text (mcq) or a model answer/rubric (other types) — never shown to the learner before evaluation. */
  referenceAnswer: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
}

export type AnswerVerdict = "correct" | "partial" | "incorrect";

/** A misconception the evaluator has named, so re-teaching targets the actual gap. */
export interface Misconception {
  id: string;
  /** Short name, e.g. "confuses current with charge". */
  label: string;
  description: string;
  relatedConceptId: string;
}

/**
 * Result of judging a student's answer against the concept. An incorrect
 * verdict must carry a misconception (or note that none could be
 * identified) so adaptation (below) has something concrete to act on —
 * "wrong" alone is not enough per the architecture's teaching loop.
 */
export interface AnswerEvaluation {
  id: string;
  questionId: string;
  studentAnswer: string;
  verdict: AnswerVerdict;
  /** Present when verdict is "partial" or "incorrect". */
  misconception?: Misconception;
  /** Feedback shown to the learner — constructive, not just "wrong". */
  feedback: string;
  /** How this answer should move difficulty for the next question: -1 easier, 0 unchanged, +1 harder. */
  difficultyAdjustment: -1 | 0 | 1;
  evaluatedAt: string;
}

/**
 * What happens after an incorrect/partial answer: re-explain with a
 * DIFFERENT analogy than the original scene used, give another example,
 * and re-question. This is the "Adapt" step of the teaching loop.
 */
export interface AdaptationPlan {
  answerEvaluationId: string;
  conceptId: string;
  /** New explanation scene using a different analogy/approach than the original. */
  reExplanationScene: Scene;
  /** A fresh checkpoint question, at the adjusted difficulty. */
  followUpQuestion: Question;
}

// ---------------------------------------------------------------------------
// Assessment and progress
// ---------------------------------------------------------------------------

export interface AssessmentReport {
  id: string;
  lessonSessionId: string;
  topic: string;
  /** 0-100. */
  score: number;
  conceptsUnderstood: string[];
  weakAreas: string[];
  misconceptionsHeld: Misconception[];
  recommendedRevision: string;
  suggestedNextTopic: string;
  generatedAt: string;
}

/** Per-concept mastery, tracked across sessions for the learner profile. */
export type MasteryLevel = "not-started" | "struggling" | "developing" | "proficient" | "mastered";

export interface ConceptProgress {
  learnerProfileId: string;
  conceptId: string;
  conceptTitle: string;
  mastery: MasteryLevel;
  /** 0-100, exponentially weighted across attempts. */
  masteryScore: number;
  lastAssessedAt: string;
}

// ---------------------------------------------------------------------------
// Learning paths (broad topics, multi-day plans)
// ---------------------------------------------------------------------------

export type LearningPathStepStatus = "locked" | "available" | "in-progress" | "completed";

export interface LearningPathStep {
  id: string;
  order: number;
  title: string;
  /** Concepts this step covers, once a LessonPlan has been generated for it. */
  conceptIds: string[];
  status: LearningPathStepStatus;
}

export interface LearningPath {
  id: string;
  learnerProfileId: string;
  topic: string;
  steps: LearningPathStep[];
  /** Index into `steps` of the learner's current position. */
  currentStepIndex: number;
  createdAt: string;
  updatedAt: string;
}
