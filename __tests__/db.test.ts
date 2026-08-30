import { beforeEach, describe, expect, it } from "vitest";

process.env.DB_PATH = ":memory:";

import { resetDbForTests } from "../lib/db/connection";
import {
  createLearnerProfile,
  getLearnerProfile,
  updateLearnerProfile,
} from "../lib/db/accessors/learners";
import { saveDocument, getDocument, getDocumentChunks } from "../lib/db/accessors/documents";
import { createLessonSession, completeLessonSession } from "../lib/db/accessors/lessonSessions";
import { createLessonPlan, getLessonPlan } from "../lib/db/accessors/lessonPlans";
import { createScenes, getScenesForLessonPlan } from "../lib/db/accessors/scenes";
import { createQuestion, getQuestionsForConcept } from "../lib/db/accessors/questions";
import { recordStudentAnswer, getStudentAnswersForSession } from "../lib/db/accessors/studentAnswers";
import { createAssessmentReport, getAssessmentReportForSession } from "../lib/db/accessors/assessmentReports";
import { upsertConceptProgress, getConceptProgressForLearner } from "../lib/db/accessors/conceptProgress";
import { createLearningPath, updateLearningPathProgress } from "../lib/db/accessors/learningPaths";
import type { Concept } from "../lib/types";

beforeEach(() => {
  resetDbForTests();
});

function makeLearner() {
  return createLearnerProfile({
    name: "Test Learner",
    level: "beginner",
    priorKnowledge: "none",
    goal: "pass exam",
    style: "analogy-heavy",
    language: "en-IN",
    minutesAvailable: 20,
    depth: "standard",
  });
}

function makeConcept(overrides: Partial<Concept> = {}): Concept {
  return {
    id: crypto.randomUUID(),
    title: "Ohm's Law",
    summary: "Relates voltage, current and resistance.",
    subject: "physics",
    difficulty: 2,
    prerequisiteConceptIds: [],
    timeBudgetSeconds: 300,
    visual: { kind: "equation", renderer: "katex", content: "V = IR", rationale: "Physics equation" },
    citations: [],
    ...overrides,
  };
}

describe("learner profile accessor", () => {
  it("creates and reads back a learner profile", () => {
    const created = makeLearner();
    const fetched = getLearnerProfile(created.id);
    expect(fetched).toEqual(created);
  });

  it("updates a learner profile", () => {
    const created = makeLearner();
    const updated = updateLearnerProfile(created.id, { minutesAvailable: 60, depth: "deep" });
    expect(updated.minutesAvailable).toBe(60);
    expect(updated.depth).toBe("deep");
    expect(updated.name).toBe(created.name);
  });

  it("throws when updating a profile that does not exist", () => {
    expect(() => updateLearnerProfile("missing-id", { minutesAvailable: 5 })).toThrow();
  });
});

describe("document + chunk accessors", () => {
  it("persists a document and its chunks together", () => {
    const { document, chunks } = saveDocument(
      { format: "txt", title: "Notes", sections: [{ order: 0, paragraphs: [{ order: 0, text: "hello" }] }] },
      [{ order: 0, text: "hello", page: undefined, section: undefined }],
    );

    expect(document.title).toBe("Notes");
    expect(chunks).toHaveLength(1);
    expect(getDocument(document.id)).toEqual(document);
    expect(getDocumentChunks(document.id)).toEqual(chunks);
  });
});

describe("lesson session, plan, scenes, questions", () => {
  it("wires a full lesson session -> plan -> concepts -> scenes -> questions chain", () => {
    const learner = makeLearner();
    const session = createLessonSession({
      learnerProfileId: learner.id,
      topic: "Electricity",
      language: "en-IN",
      totalMinutes: 20,
      depth: "standard",
    });

    const concept = makeConcept();
    const plan = createLessonPlan({
      lessonSessionId: session.id,
      learnerProfileId: learner.id,
      topic: "Electricity",
      language: "en-IN",
      totalMinutes: 20,
      depth: "standard",
      concepts: [concept],
    });

    expect(getLessonPlan(plan.id)?.concepts[0].title).toBe("Ohm's Law");

    const [scene] = createScenes([
      {
        lessonPlanId: plan.id,
        conceptId: concept.id,
        type: "explanation",
        order: 0,
        narration: "Voltage equals current times resistance.",
        visual: concept.visual,
        estimatedSeconds: 60,
      },
    ]);
    expect(getScenesForLessonPlan(plan.id)).toHaveLength(1);

    const question = createQuestion({
      conceptId: concept.id,
      sceneId: scene.id,
      type: "mcq",
      prompt: "What happens to current if resistance increases and voltage stays constant?",
      options: ["Increases", "Decreases", "Stays the same"],
      referenceAnswer: "Decreases",
      difficulty: 2,
    });
    expect(getQuestionsForConcept(concept.id)).toHaveLength(1);

    const answer = recordStudentAnswer({
      questionId: question.id,
      lessonSessionId: session.id,
      studentAnswer: "Increases",
      verdict: "incorrect",
      misconception: {
        id: crypto.randomUUID(),
        label: "confuses current with charge",
        description: "Believes current rises with resistance under Ohm's law.",
        relatedConceptId: concept.id,
      },
      feedback: "Not quite — under Ohm's law, current decreases as resistance rises for a fixed voltage.",
      difficultyAdjustment: -1,
    });
    expect(getStudentAnswersForSession(session.id)).toEqual([answer]);
    expect(answer.misconception?.label).toBe("confuses current with charge");

    const report = createAssessmentReport({
      lessonSessionId: session.id,
      topic: "Electricity",
      score: 80,
      conceptsUnderstood: ["Current", "Voltage"],
      weakAreas: ["Ohm's Law"],
      misconceptionsHeld: [],
      recommendedRevision: "Revise Ohm's Law.",
      suggestedNextTopic: "Circuits",
    });
    expect(getAssessmentReportForSession(session.id)).toEqual(report);

    const progress = upsertConceptProgress({
      learnerProfileId: learner.id,
      conceptId: concept.id,
      conceptTitle: concept.title,
      mastery: "struggling",
      masteryScore: 40,
    });
    expect(getConceptProgressForLearner(learner.id)).toEqual([progress]);

    const updatedProgress = upsertConceptProgress({
      learnerProfileId: learner.id,
      conceptId: concept.id,
      conceptTitle: concept.title,
      mastery: "developing",
      masteryScore: 60,
    });
    expect(getConceptProgressForLearner(learner.id)).toEqual([updatedProgress]);

    const completed = completeLessonSession(session.id);
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).not.toBeNull();
  });
});

describe("learning path accessor", () => {
  it("creates and advances a learning path", () => {
    const learner = makeLearner();
    const path = createLearningPath({
      learnerProfileId: learner.id,
      topic: "Machine Learning",
      steps: [
        { id: "1", order: 0, title: "Python Fundamentals", conceptIds: [], status: "available" },
        { id: "2", order: 1, title: "Math for ML", conceptIds: [], status: "locked" },
      ],
    });

    const updated = updateLearningPathProgress(
      path.id,
      [
        { id: "1", order: 0, title: "Python Fundamentals", conceptIds: [], status: "completed" },
        { id: "2", order: 1, title: "Math for ML", conceptIds: [], status: "available" },
      ],
      1,
    );

    expect(updated.currentStepIndex).toBe(1);
    expect(updated.steps[0].status).toBe("completed");
  });
});
