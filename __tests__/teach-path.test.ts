import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubChatSequence } from "./support/sarvamMock";
import { generateLearningPath, unlockNextStep } from "../lib/teach/path";
import type { LearningPathStep } from "../lib/types";

const ORIGINAL_KEY = process.env.SARVAM_API_KEY;

beforeEach(() => {
  process.env.SARVAM_API_KEY = "test-key";
});

afterEach(() => {
  process.env.SARVAM_API_KEY = ORIGINAL_KEY;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const LEARNER = { level: "beginner" as const, goal: "get a job", priorKnowledge: "none" };

describe("generateLearningPath", () => {
  it("unlocks only the first step for a broad topic", async () => {
    stubChatSequence({
      steps: [
        { title: "Python Fundamentals", summary: "s" },
        { title: "Mathematics for ML", summary: "s" },
        { title: "Supervised Learning", summary: "s" },
      ],
    });

    const steps = await generateLearningPath({ topic: "Machine Learning", learnerProfile: LEARNER, mode: "broad-topic" });

    expect(steps).toHaveLength(3);
    expect(steps[0].status).toBe("available");
    expect(steps[1].status).toBe("locked");
    expect(steps[2].status).toBe("locked");
    expect(steps.map((s) => s.order)).toEqual([0, 1, 2]);
  });

  it("produces exactly totalSessions steps for a multi-day request", async () => {
    stubChatSequence({
      steps: Array.from({ length: 7 }, (_, i) => ({ title: `Day ${i + 1}`, summary: "s" })),
    });

    const steps = await generateLearningPath({ topic: "ML", learnerProfile: LEARNER, mode: "multi-day", totalSessions: 7, minutesPerSession: 30 });
    expect(steps).toHaveLength(7);
  });

  it("throws when multi-day mode is requested without totalSessions", async () => {
    await expect(generateLearningPath({ topic: "ML", learnerProfile: LEARNER, mode: "multi-day" })).rejects.toThrow();
  });
});

describe("unlockNextStep", () => {
  const steps: LearningPathStep[] = [
    { id: "1", order: 0, title: "A", conceptIds: [], status: "available" },
    { id: "2", order: 1, title: "B", conceptIds: [], status: "locked" },
    { id: "3", order: 2, title: "C", conceptIds: [], status: "locked" },
  ];

  it("marks the completed step done and unlocks only the next one", () => {
    const updated = unlockNextStep(steps, 0);
    expect(updated[0].status).toBe("completed");
    expect(updated[1].status).toBe("available");
    expect(updated[2].status).toBe("locked");
  });
});
