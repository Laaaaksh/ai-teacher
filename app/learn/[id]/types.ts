/** Client-side mirrors of the lib/types.ts / lib/db row shapes the teach API returns. */

export type LanguageCode = string;

export interface Citation {
  documentId: string;
  chunkId: string;
  page?: number;
  section?: string;
  excerpt: string;
}

export interface VisualSpec {
  kind: string;
  renderer: string;
  content: string;
  caption?: string;
  rationale: string;
}

export interface Concept {
  id: string;
  title: string;
  summary: string;
  subject: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  prerequisiteConceptIds: string[];
  timeBudgetSeconds: number;
  visual: VisualSpec;
  citations: Citation[];
}

export interface LessonPlan {
  id: string;
  learnerProfileId: string;
  topic: string;
  sourceDocumentId?: string;
  language: LanguageCode;
  totalMinutes: number;
  depth: string;
  concepts: Concept[];
  createdAt: string;
}

export type SceneType = "introduction" | "explanation" | "example" | "checkpoint" | "transition" | "summary";

export interface Scene {
  id: string;
  lessonPlanId: string;
  conceptId: string;
  type: SceneType;
  order: number;
  narration: string;
  visual?: VisualSpec;
  questionId?: string;
  estimatedSeconds: number;
}

export interface Question {
  id: string;
  conceptId: string;
  sceneId?: string;
  type: "mcq" | "short-answer" | "problem-solving" | "application" | "explain-in-own-words";
  prompt: string;
  options?: string[];
  difficulty: 1 | 2 | 3 | 4 | 5;
}

export interface Misconception {
  id: string;
  label: string;
  description: string;
  relatedConceptId: string;
}

export interface AnswerEvaluation {
  id: string;
  questionId: string;
  studentAnswer: string;
  verdict: "correct" | "partial" | "incorrect";
  misconception?: Misconception;
  feedback: string;
  difficultyAdjustment: -1 | 0 | 1;
  evaluatedAt: string;
}

export interface AdaptationResult {
  targetConceptId: string;
  droppedToPrerequisite: boolean;
  reExplanationScene: Scene;
  followUpQuestion: Question;
  checkpointScene: Scene;
}

export interface LessonSession {
  id: string;
  learnerProfileId: string;
  topic: string;
  sourceDocumentId: string | null;
  language: LanguageCode;
  totalMinutes: number;
  depth: string;
  status: "active" | "completed" | "abandoned";
  currentSceneOrder: number;
  startedAt: string;
  completedAt: string | null;
  scriptingStatus: "pending" | "in_progress" | "ready" | "partial" | "failed";
  scriptingError: string | null;
}

export interface SessionSnapshot {
  session: LessonSession;
  plan: LessonPlan | null;
  scenes: Scene[];
  scriptingProgress: { scriptedConcepts: number; totalConcepts: number };
  answers: AnswerEvaluation[];
}

export interface AssessmentReport {
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
