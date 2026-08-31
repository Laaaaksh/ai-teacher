import type { LessonPlan, Scene } from "./types";

/**
 * A concept's checkpoint scene order — everything after it (its "transition"
 * beat) narrates a bridge into the NEXT concept, not this one, so it must
 * not play before this concept's own question.
 */
export function checkpointOrderFor(scenes: Scene[], conceptId: string): number {
  return scenes.find((s) => s.conceptId === conceptId && s.type === "checkpoint")?.order ?? Infinity;
}

/**
 * A concept's teaching segment is its own pre-checkpoint beats (intro/
 * explanation/example) PLUS the previous concept's trailing "transition"
 * beat, which is authored to bridge INTO this concept and therefore belongs
 * at the start of this segment, not the end of the previous one.
 *
 * Pulled out of LessonPlayer.tsx (a "use client" component) into its own
 * plain module so it's importable from a vitest test without pulling in
 * JSX — see __tests__/lesson-player-segment.test.ts, the regression test
 * for the adaptation-scene bridge leak this function fixes.
 */
export function teachingSegmentFor(scenes: Scene[], plan: LessonPlan, conceptIndex: number): Scene[] {
  const concept = plan.concepts[conceptIndex];
  const ownCheckpointOrder = checkpointOrderFor(scenes, concept.id);
  const own = scenes.filter((s) => s.conceptId === concept.id && s.type !== "checkpoint" && s.type !== "summary" && s.order < ownCheckpointOrder);

  /* Only the transition beat: an adaptation re-explanation is also an
   * above-the-checkpoint scene on the previous concept, and it has already
   * been watched by the time this concept starts. */
  const bridge =
    conceptIndex > 0 ? scenes.filter((s) => s.conceptId === plan.concepts[conceptIndex - 1].id && s.type === "transition") : [];

  return [...bridge, ...own].sort((a, b) => a.order - b.order);
}
