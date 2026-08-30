import type {
  Citation,
  Concept,
  LanguageCode,
  LearnerLevel,
  LearningDepth,
  LearningPathStep,
  Misconception,
  QuestionType,
  SceneType,
  Subject,
  VisualSpec,
} from "../types";
import type { DocumentFormat as DocFormat } from "../documents/types";

// Row shapes returned by lib/db accessors. These mirror the SQL schema in
// lib/db/migrations.ts (see docs/SCHEMA.md); JSON columns are already
// parsed back into their lib/types.ts shapes here so callers never touch SQL.

export interface LearnerProfileRow {
  id: string;
  name: string;
  level: LearnerLevel;
  priorKnowledge: string;
  goal: string;
  style: string;
  language: LanguageCode;
  minutesAvailable: number;
  depth: LearningDepth;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentRow {
  id: string;
  title: string;
  format: DocFormat;
  pageCount: number | null;
  language: string | null;
  uploadedAt: string;
}

export interface DocumentChunkRow {
  id: string;
  documentId: string;
  order: number;
  text: string;
  page: number | null;
  section: string | null;
  createdAt: string;
}

export type LessonSessionStatus = "active" | "completed" | "abandoned";

export type ScriptingStatus = "pending" | "in_progress" | "ready" | "partial" | "failed";

export interface LessonSessionRow {
  id: string;
  learnerProfileId: string;
  topic: string;
  sourceDocumentId: string | null;
  language: LanguageCode;
  totalMinutes: number;
  depth: LearningDepth;
  status: LessonSessionStatus;
  currentSceneOrder: number;
  startedAt: string;
  completedAt: string | null;
  /** POST /api/teach/sessions returns as soon as planning finishes; scripting runs in the background and a caller polls this field via GET /api/teach/sessions/:id. */
  scriptingStatus: ScriptingStatus;
  /** Set when scriptingStatus is 'partial' or 'failed' — names which concepts failed and why. */
  scriptingError: string | null;
}

export interface LessonPlanRow {
  id: string;
  lessonSessionId: string;
  learnerProfileId: string;
  topic: string;
  sourceDocumentId: string | null;
  language: LanguageCode;
  totalMinutes: number;
  depth: LearningDepth;
  concepts: Concept[];
  createdAt: string;
}

export interface ConceptRow {
  id: string;
  lessonPlanId: string;
  order: number;
  title: string;
  summary: string;
  subject: Subject;
  difficulty: 1 | 2 | 3 | 4 | 5;
  prerequisiteConceptIds: string[];
  timeBudgetSeconds: number;
  visual: VisualSpec;
  citations: Citation[];
}

export interface SceneRow {
  id: string;
  lessonPlanId: string;
  conceptId: string;
  type: SceneType;
  order: number;
  narration: string;
  visual: VisualSpec | null;
  questionId: string | null;
  estimatedSeconds: number;
}

export interface QuestionRow {
  id: string;
  conceptId: string;
  sceneId: string | null;
  type: QuestionType;
  prompt: string;
  options: string[] | null;
  referenceAnswer: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  createdAt: string;
}

export type AnswerVerdict = "correct" | "partial" | "incorrect";

export interface StudentAnswerRow {
  id: string;
  questionId: string;
  lessonSessionId: string;
  studentAnswer: string;
  verdict: AnswerVerdict;
  misconception: Misconception | null;
  feedback: string;
  difficultyAdjustment: -1 | 0 | 1;
  evaluatedAt: string;
}

export interface AssessmentReportRow {
  id: string;
  lessonSessionId: string;
  topic: string;
  score: number;
  conceptsUnderstood: string[];
  weakAreas: string[];
  misconceptionsHeld: Misconception[];
  recommendedRevision: string;
  suggestedNextTopic: string;
  generatedAt: string;
}

export type MasteryLevel = "not-started" | "struggling" | "developing" | "proficient" | "mastered";

export interface ConceptProgressRow {
  learnerProfileId: string;
  conceptId: string;
  conceptTitle: string;
  mastery: MasteryLevel;
  masteryScore: number;
  lastAssessedAt: string;
}

export interface LearningPathRow {
  id: string;
  learnerProfileId: string;
  topic: string;
  steps: LearningPathStep[];
  currentStepIndex: number;
  createdAt: string;
  updatedAt: string;
}
