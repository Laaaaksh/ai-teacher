import { describe, expect, it } from "vitest";
import { checkpointOrderFor, teachingSegmentFor } from "../app/learn/[id]/segment";
import type { Concept, LessonPlan, Scene } from "../app/learn/[id]/types";

/**
 * Regression test for a real bug found by running the lesson end to end
 * against the live API: teachingSegmentFor's "bridge" used to admit ANY
 * non-checkpoint/non-summary scene above a concept's checkpoint order, not
 * just its authored "transition" beat. An adaptation re-explanation scene
 * (lib/teach/adapt.ts's adaptAfterIncorrectAnswer, persisted at a high
 * order after the original scene list) matched that filter just as well,
 * so a learner who missed an earlier concept's checkpoint saw their own
 * remedial re-teaching replayed a second time at the start of the next
 * concept's video segment. Fixed by restricting the bridge to
 * type === "transition".
 */

function concept(id: string, overrides: Partial<Concept> = {}): Concept {
  return {
    id,
    title: id,
    summary: "",
    subject: "physics",
    difficulty: 1,
    prerequisiteConceptIds: [],
    timeBudgetSeconds: 60,
    citations: [],
    visual: { kind: "diagram", renderer: "mermaid", content: "graph LR; A-->B", rationale: "test" },
    ...overrides,
  };
}

function scene(overrides: Partial<Scene> & Pick<Scene, "id" | "conceptId" | "type" | "order">): Scene {
  return {
    lessonPlanId: "plan-1",
    narration: "",
    estimatedSeconds: 30,
    ...overrides,
  };
}

const plan: LessonPlan = {
  id: "plan-1",
  learnerProfileId: "learner-1",
  topic: "Electricity",
  language: "en-IN",
  totalMinutes: 15,
  depth: "standard",
  createdAt: "now",
  concepts: [concept("concept-1"), concept("concept-2"), concept("concept-3")],
};

describe("teachingSegmentFor — adaptation-scene bridge leak (regression)", () => {
  it("does not replay a wrong-answer re-explanation scene in the next concept's segment", () => {
    // Concept 1's original scripted beats: orders 0-4 (checkpoint@3, transition@4) — matches
    // the real scene-order layout traced live (docs/submission's adaptation trace).
    const concept1Beats: Scene[] = [
      scene({ id: "c1-intro", conceptId: "concept-1", type: "introduction", order: 0 }),
      scene({ id: "c1-explain", conceptId: "concept-1", type: "explanation", order: 1 }),
      scene({ id: "c1-example", conceptId: "concept-1", type: "example", order: 2 }),
      scene({ id: "c1-checkpoint", conceptId: "concept-1", type: "checkpoint", order: 3, questionId: "q-c1" }),
      scene({ id: "c1-transition", conceptId: "concept-1", type: "transition", order: 4 }),
    ];
    // Concept 2's own beats: orders 5-9.
    const concept2Beats: Scene[] = [
      scene({ id: "c2-intro", conceptId: "concept-2", type: "introduction", order: 5 }),
      scene({ id: "c2-explain", conceptId: "concept-2", type: "explanation", order: 6 }),
      scene({ id: "c2-example", conceptId: "concept-2", type: "example", order: 7 }),
      scene({ id: "c2-checkpoint", conceptId: "concept-2", type: "checkpoint", order: 8, questionId: "q-c2" }),
      scene({ id: "c2-transition", conceptId: "concept-2", type: "transition", order: 9 }),
    ];
    // The learner answered concept 1's checkpoint wrong: adaptAfterIncorrectAnswer persists a
    // re-explanation (type "explanation") and a fresh checkpoint scene, appended at a high order.
    const adaptationScenes: Scene[] = [
      scene({ id: "c1-reexplain", conceptId: "concept-1", type: "explanation", order: 16 }),
      scene({ id: "c1-followup-checkpoint", conceptId: "concept-1", type: "checkpoint", order: 17, questionId: "q-c1-followup" }),
    ];

    const scenes = [...concept1Beats, ...concept2Beats, ...adaptationScenes];

    const concept2Segment = teachingSegmentFor(scenes, plan, 1);
    const idsInSegment = concept2Segment.map((s) => s.id);

    // The leak: the adaptation re-explanation must NOT be replayed at the start of concept 2's segment.
    expect(idsInSegment).not.toContain("c1-reexplain");
    // The intended bridge: concept 1's authored transition beat DOES belong at the start of concept 2's segment.
    expect(idsInSegment[0]).toBe("c1-transition");
    // Followed by concept 2's own pre-checkpoint beats, in order.
    expect(idsInSegment).toEqual(["c1-transition", "c2-intro", "c2-explain", "c2-example"]);
  });

  it("checkpointOrderFor finds the concept's original checkpoint, not the later adaptation follow-up", () => {
    const scenes: Scene[] = [
      scene({ id: "c1-checkpoint", conceptId: "concept-1", type: "checkpoint", order: 3, questionId: "q-c1" }),
      scene({ id: "c1-followup-checkpoint", conceptId: "concept-1", type: "checkpoint", order: 17, questionId: "q-c1-followup" }),
    ];
    expect(checkpointOrderFor(scenes, "concept-1")).toBe(3);
  });

  it("the first concept's segment has no bridge to pull in", () => {
    const scenes: Scene[] = [
      scene({ id: "c1-intro", conceptId: "concept-1", type: "introduction", order: 0 }),
      scene({ id: "c1-checkpoint", conceptId: "concept-1", type: "checkpoint", order: 1, questionId: "q-c1" }),
    ];
    expect(teachingSegmentFor(scenes, plan, 0).map((s) => s.id)).toEqual(["c1-intro"]);
  });
});
