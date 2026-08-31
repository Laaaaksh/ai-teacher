"use client";

import { useEffect, useState } from "react";
import { VideoSegment } from "./VideoSegment";
import { CheckpointQuestion } from "./CheckpointQuestion";
import { AskAnything } from "./AskAnything";
import type { AdaptationResult, AnswerEvaluation, LessonPlan, LessonSession, Question, Scene } from "./types";

type Phase = "loading-scenes" | "skipped-concept" | "segment" | "checkpoint" | "submitting" | "feedback" | "summary" | "error";

interface FeedbackState {
  evaluation: AnswerEvaluation;
  adaptation: AdaptationResult | null;
}

/** A concept's checkpoint scene order — everything after it (its "transition" beat) narrates a bridge into the NEXT concept, not this one, so it must not play before this concept's own question. */
function checkpointOrderFor(scenes: Scene[], conceptId: string): number {
  return scenes.find((s) => s.conceptId === conceptId && s.type === "checkpoint")?.order ?? Infinity;
}

/**
 * A concept's teaching segment is its own pre-checkpoint beats (intro/
 * explanation/example) PLUS the previous concept's trailing "transition"
 * beat, which is authored to bridge INTO this concept and therefore belongs
 * at the start of this segment, not the end of the previous one.
 */
function teachingSegmentFor(scenes: Scene[], plan: LessonPlan, conceptIndex: number): Scene[] {
  const concept = plan.concepts[conceptIndex];
  const ownCheckpointOrder = checkpointOrderFor(scenes, concept.id);
  const own = scenes.filter((s) => s.conceptId === concept.id && s.type !== "checkpoint" && s.type !== "summary" && s.order < ownCheckpointOrder);

  let bridge: Scene[] = [];
  if (conceptIndex > 0) {
    const prevConcept = plan.concepts[conceptIndex - 1];
    const prevCheckpointOrder = checkpointOrderFor(scenes, prevConcept.id);
    bridge = scenes.filter((s) => s.conceptId === prevConcept.id && s.type !== "checkpoint" && s.type !== "summary" && s.order > prevCheckpointOrder);
  }

  return [...bridge, ...own].sort((a, b) => a.order - b.order);
}

/**
 * The teaching video plays one segment at a time (a concept's teaching
 * beats, then a re-explanation after a wrong answer), pausing at every
 * checkpoint for a real question. Video is rendered on demand per segment
 * (lib/video/render.ts's sceneIds option) rather than for the whole lesson
 * up front, since adaptation scenes don't exist until the learner answers.
 */
export function LessonPlayer({
  session: initialSession,
  plan,
  onFinished,
}: {
  session: LessonSession;
  plan: LessonPlan;
  onFinished: () => void;
}) {
  const [session, setSession] = useState(initialSession);
  const [conceptIndex, setConceptIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("loading-scenes");
  const [activeSceneIds, setActiveSceneIds] = useState<string[]>([]);
  const [skipTitleCard, setSkipTitleCard] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState<Question | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reviewingConceptTitle, setReviewingConceptTitle] = useState<string | null>(null);

  const concept = plan.concepts[conceptIndex];

  // Wait for the current concept's scenes to finish background scripting, then start teaching it.
  useEffect(() => {
    if (phase !== "loading-scenes") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/teach/sessions/${session.id}`);
        const data = await res.json();
        if (cancelled) return;

        const scenes: Scene[] = data.scenes;
        const hasCheckpoint = scenes.some((s) => s.conceptId === concept.id && s.type === "checkpoint");
        const terminal = ["ready", "partial", "failed"].includes(data.session.scriptingStatus);

        if (hasCheckpoint) {
          const teachingScenes = teachingSegmentFor(scenes, plan, conceptIndex);
          setSkipTitleCard(conceptIndex > 0);
          setReviewingConceptTitle(null);
          if (teachingScenes.length > 0) {
            setActiveSceneIds(teachingScenes.map((s) => s.id));
            setPhase("segment");
          } else {
            await beginCheckpoint(scenes);
          }
        } else if (terminal) {
          setNote(`Couldn't generate "${concept.title}" — moving on.`);
          setPhase("skipped-concept");
        } else {
          timer = setTimeout(poll, 2000);
        }
      } catch {
        if (!cancelled) timer = setTimeout(poll, 2500);
      }
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, conceptIndex]);

  useEffect(() => {
    if (phase !== "skipped-concept") return;
    const timer = setTimeout(() => advanceConcept(), 1800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function beginCheckpoint(scenes: Scene[]) {
    const checkpointScene = scenes.find((s) => s.conceptId === concept.id && s.type === "checkpoint");
    if (!checkpointScene?.questionId) {
      setNote(`"${concept.title}" has no checkpoint question — moving on.`);
      setPhase("skipped-concept");
      return;
    }
    await loadQuestion(checkpointScene.questionId);
  }

  async function loadQuestion(questionId: string) {
    try {
      const res = await fetch(`/api/teach/questions/${questionId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't load the question.");
      setActiveQuestion(data.question);
      setPhase("checkpoint");
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    }
  }

  function advanceConcept() {
    setFeedback(null);
    setActiveQuestion(null);
    setReviewingConceptTitle(null);
    if (conceptIndex + 1 < plan.concepts.length) {
      setConceptIndex((i) => i + 1);
      setPhase("loading-scenes");
    } else {
      finishWithSummary();
    }
  }

  async function finishWithSummary() {
    try {
      const res = await fetch(`/api/teach/sessions/${session.id}`);
      const data = await res.json();
      const summaryScene: Scene | undefined = data.scenes.find((s: Scene) => s.type === "summary");
      if (summaryScene) {
        setSkipTitleCard(true);
        setActiveSceneIds([summaryScene.id]);
        setPhase("summary");
        return;
      }
    } catch {
      // fall through to finishing without a summary clip
    }
    onFinished();
  }

  async function submitAnswer(answer: string) {
    if (!activeQuestion) return;
    setPhase("submitting");
    setError(null);
    try {
      const res = await fetch(`/api/teach/sessions/${session.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: activeQuestion.id, studentAnswer: answer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't evaluate that answer.");
      setFeedback({ evaluation: data.evaluation, adaptation: data.adaptation });
      if (data.adaptation) {
        const targetConcept = plan.concepts.find((c) => c.id === data.adaptation.targetConceptId);
        setReviewingConceptTitle(data.adaptation.droppedToPrerequisite ? (targetConcept?.title ?? null) : null);
      }
      setPhase("feedback");
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    }
  }

  function beginAdaptationSegment(adaptation: AdaptationResult) {
    setSkipTitleCard(true);
    setActiveSceneIds([adaptation.reExplanationScene.id]);
    setActiveQuestion(adaptation.followUpQuestion);
    setPhase("segment");
  }

  return (
    <div className="flex flex-col gap-6">
      <ProgressHeader plan={plan} conceptIndex={conceptIndex} phase={phase} reviewingConceptTitle={reviewingConceptTitle} />

      {phase === "loading-scenes" && (
        <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-neutral-100 text-sm text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
          Preparing &ldquo;{concept.title}&rdquo;…
        </div>
      )}

      {phase === "skipped-concept" && note && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {note}
        </div>
      )}

      {(phase === "segment" || phase === "summary") && (
        <VideoSegment
          lessonPlanId={plan.id}
          sceneIds={activeSceneIds}
          skipTitleCard={skipTitleCard}
          onEnded={() => {
            if (phase === "summary") {
              onFinished();
            } else if (activeQuestion) {
              setPhase("checkpoint");
            } else {
              fetch(`/api/teach/sessions/${session.id}`)
                .then((r) => r.json())
                .then((data) => beginCheckpoint(data.scenes));
            }
          }}
        />
      )}

      {(phase === "checkpoint" || phase === "submitting") && activeQuestion && (
        <CheckpointQuestion question={activeQuestion} language={session.language} onSubmit={submitAnswer} submitting={phase === "submitting"} />
      )}

      {phase === "feedback" && feedback && (
        <FeedbackCard feedback={feedback} onContinue={() => (feedback.adaptation ? beginAdaptationSegment(feedback.adaptation) : advanceConcept())} />
      )}

      {phase === "error" && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <p>{error}</p>
          <button type="button" onClick={() => setPhase("loading-scenes")} className="btn-secondary mt-3">
            Retry
          </button>
        </div>
      )}

      <AskAnything sessionId={session.id} onLanguageSwitched={setSession} />
    </div>
  );
}

function ProgressHeader({
  plan,
  conceptIndex,
  phase,
  reviewingConceptTitle,
}: {
  plan: LessonPlan;
  conceptIndex: number;
  phase: Phase;
  reviewingConceptTitle: string | null;
}) {
  const concept = plan.concepts[conceptIndex];
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
        Concept {conceptIndex + 1} of {plan.concepts.length}
      </p>
      <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
        {phase === "summary" ? "Wrapping up" : reviewingConceptTitle ? `Reviewing: ${reviewingConceptTitle}` : concept.title}
      </h2>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div
          className="h-full bg-neutral-900 transition-all dark:bg-neutral-100"
          style={{ width: `${Math.round(((conceptIndex + (phase === "summary" ? 1 : 0)) / plan.concepts.length) * 100)}%` }}
        />
      </div>
    </div>
  );
}

function FeedbackCard({ feedback, onContinue }: { feedback: FeedbackState; onContinue: () => void }) {
  const { evaluation, adaptation } = feedback;
  const correct = evaluation.verdict === "correct";

  return (
    <div
      className={`rounded-xl border p-6 shadow-sm ${
        correct
          ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950"
          : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950"
      }`}
    >
      <p className={`text-xs font-medium uppercase tracking-wide ${correct ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
        {correct ? "Correct" : evaluation.verdict === "partial" ? "Partially right" : "Not quite"}
      </p>
      <p className="mt-2 text-sm text-neutral-800 dark:text-neutral-200">{evaluation.feedback}</p>

      {!correct && evaluation.misconception && (
        <div className="mt-3 rounded-lg bg-white/60 p-3 dark:bg-black/20">
          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">What&apos;s actually going on</p>
          <p className="mt-1 text-sm font-medium text-neutral-900 dark:text-neutral-50">{evaluation.misconception.label}</p>
          <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">{evaluation.misconception.description}</p>
        </div>
      )}

      {!correct && adaptation && (
        <p className="mt-3 text-sm text-neutral-700 dark:text-neutral-300">
          {adaptation.droppedToPrerequisite
            ? "Let's back up and re-cover the concept this builds on, with a different example."
            : "Let's try that again with a different explanation and example."}
        </p>
      )}

      <button type="button" onClick={onContinue} className="btn-primary mt-4">
        {correct ? "Continue →" : "See the re-explanation →"}
      </button>
    </div>
  );
}
