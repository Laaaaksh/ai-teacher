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
  runInTransaction,
  seedAdaptationState,
} from "../db";
import { planLesson } from "./plan";
import { scriptConcept, scriptLessonSummary } from "./script";
import type { ScriptedConcept } from "./script";
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

  /* Every LLM call happens before anything is written: a concept whose
   * scripting call times out must not leave a `status = 'active'` session
   * behind whose scene list is silently truncated — from the outside that is
   * indistinguishable from a complete lesson. */
  const scripted: ScriptedConcept[] = [];
  for (const concept of concepts) {
    scripted.push(await scriptConcept({ concept, learnerProfile: input.learnerProfile, language: input.language }));
  }

  const summaryBeat = await scriptLessonSummary({
    topic: input.topic,
    concepts,
    learnerProfile: input.learnerProfile,
    language: input.language,
  });

  return runInTransaction(() => {
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

    concepts.forEach((concept, index) => {
      const conceptScript = scripted[index];
      const explanationBeat = conceptScript.beats.find((b) => b.type === "explanation");

      seedAdaptationState({
        lessonSessionId: session.id,
        conceptId: concept.id,
        initialAnalogy: explanationBeat?.analogyLabel,
        initialDifficulty: conceptScript.question.difficulty,
      });

      const question = createQuestion({
        conceptId: concept.id,
        type: conceptScript.question.type,
        prompt: conceptScript.question.prompt,
        options: conceptScript.question.options,
        referenceAnswer: conceptScript.question.referenceAnswer,
        difficulty: conceptScript.question.difficulty,
      });
      questions.push(question);

      const sceneInputs: CreateSceneInput[] = conceptScript.beats.map((beat) => ({
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
  });
}
