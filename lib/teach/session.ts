/**
 * Orchestrates Plan -> Explain/Demonstrate/Question -> persistence into one
 * call: plans the concept sequence, scripts each concept into scenes plus a
 * checkpoint question, and writes all of it (lesson_session, lesson_plan,
 * concepts, scenes, questions, seeded adaptation state) through lib/db's
 * accessors. This is the glue app/api/teach/sessions/route.ts calls; the
 * HTTP-shaped concerns (404s, validation) stay in the route.
 */
import {
  createLessonPlan,
  createLessonSession,
  createQuestion,
  createScenes,
  seedAdaptationState,
} from "../db";
import { planLesson } from "./plan";
import { scriptConcept, scriptLessonSummary } from "./script";
import type { CreateSceneInput } from "../db/accessors/scenes";
import type { ConceptProgressRow, DocumentChunkRow, LearnerProfileRow, LessonPlanRow, LessonSessionRow, QuestionRow, SceneRow } from "../db/types";
import type { LanguageCode, LearningDepth } from "../types";

export interface CreateTaughtSessionInput {
  learnerProfile: LearnerProfileRow;
  topic: string;
  sourceDocumentId?: string;
  documentChunks?: DocumentChunkRow[];
  sectionHint?: string;
  totalMinutes: number;
  depth: LearningDepth;
  language: LanguageCode;
  priorProgress?: ConceptProgressRow[];
}

export interface TaughtSession {
  session: LessonSessionRow;
  plan: LessonPlanRow;
  scenes: SceneRow[];
  questions: QuestionRow[];
}

export async function createTaughtLessonSession(input: CreateTaughtSessionInput): Promise<TaughtSession> {
  const concepts = await planLesson({
    topic: input.topic,
    learnerProfile: input.learnerProfile,
    language: input.language,
    totalMinutes: input.totalMinutes,
    depth: input.depth,
    sourceDocumentId: input.sourceDocumentId,
    sourceChunks: input.documentChunks,
    sectionHint: input.sectionHint,
    priorProgress: input.priorProgress,
  });

  if (concepts.length === 0) {
    throw new Error("planLesson produced no concepts.");
  }

  const session = createLessonSession({
    learnerProfileId: input.learnerProfile.id,
    topic: input.topic,
    sourceDocumentId: input.sourceDocumentId,
    language: input.language,
    totalMinutes: input.totalMinutes,
    depth: input.depth,
  });

  const plan = createLessonPlan({
    lessonSessionId: session.id,
    learnerProfileId: input.learnerProfile.id,
    topic: input.topic,
    sourceDocumentId: input.sourceDocumentId,
    language: input.language,
    totalMinutes: input.totalMinutes,
    depth: input.depth,
    concepts,
  });

  const scenes: SceneRow[] = [];
  const questions: QuestionRow[] = [];
  let order = 0;

  for (const concept of concepts) {
    const scripted = await scriptConcept({ concept, learnerProfile: input.learnerProfile, language: input.language });
    const explanationBeat = scripted.beats.find((b) => b.type === "explanation");

    seedAdaptationState({
      lessonSessionId: session.id,
      conceptId: concept.id,
      initialAnalogy: explanationBeat?.analogyLabel,
      initialDifficulty: scripted.question.difficulty,
    });

    const question = createQuestion({
      conceptId: concept.id,
      type: scripted.question.type,
      prompt: scripted.question.prompt,
      options: scripted.question.options,
      referenceAnswer: scripted.question.referenceAnswer,
      difficulty: scripted.question.difficulty,
    });
    questions.push(question);

    const sceneInputs: CreateSceneInput[] = scripted.beats.map((beat) => ({
      lessonPlanId: plan.id,
      conceptId: concept.id,
      type: beat.type,
      order: order++,
      narration: beat.narration,
      visual: beat.visual,
      questionId: beat.type === "checkpoint" ? question.id : undefined,
      estimatedSeconds: beat.estimatedSeconds,
    }));
    scenes.push(...createScenes(sceneInputs));
  }

  const summaryBeat = await scriptLessonSummary({
    topic: input.topic,
    concepts,
    learnerProfile: input.learnerProfile,
    language: input.language,
  });
  scenes.push(
    ...createScenes([
      {
        lessonPlanId: plan.id,
        conceptId: concepts[concepts.length - 1].id,
        type: "summary",
        order: order++,
        narration: summaryBeat.narration,
        visual: summaryBeat.visual,
        estimatedSeconds: summaryBeat.estimatedSeconds,
      },
    ]),
  );

  return { session, plan, scenes, questions };
}
