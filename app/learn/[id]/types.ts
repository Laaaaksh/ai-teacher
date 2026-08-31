/**
 * The lesson player's view of the teach API's wire shapes. These are the
 * real contracts — lib/types.ts (the shared domain types every slice codes
 * against) and the lib/db row shapes the routes serialize — re-exported
 * rather than hand-mirrored, so a field change there is a type error here
 * instead of silent drift. Both modules are type-only imports, so nothing
 * from lib/db's runtime reaches the client bundle.
 */
import type { AnswerEvaluation, LessonPlan, Question as DomainQuestion, Scene } from "@/lib/types";
import type { LessonSessionRow } from "@/lib/db/types";

export type {
  AnswerEvaluation,
  AssessmentReport,
  Citation,
  Concept,
  LanguageCode,
  LessonPlan,
  Misconception,
  Scene,
  SceneType,
  VisualSpec,
} from "@/lib/types";

export type LessonSession = LessonSessionRow;

/** `referenceAnswer` is deliberately never sent to the client — it stays server-side until the answer has been evaluated. */
export type Question = Omit<DomainQuestion, "referenceAnswer">;

/** GET /api/teach/sessions/[id] — everything needed to render or resume a session. */
export interface SessionSnapshot {
  session: LessonSession;
  plan: LessonPlan | null;
  scenes: Scene[];
  scriptingProgress: { scriptedConcepts: number; totalConcepts: number };
  answers: AnswerEvaluation[];
}

/** POST /api/teach/sessions/[id]/answer's adaptation payload — the re-explanation scene and the follow-up question it ends on. */
export interface AdaptationResult {
  targetConceptId: string;
  droppedToPrerequisite: boolean;
  reExplanationScene: Scene;
  followUpQuestion: Question;
  checkpointScene: Scene;
}
