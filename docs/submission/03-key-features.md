# Key features

## 1. The teaching loop, end to end (the headline feature)

Understand → Plan → Explain → Demonstrate → Question → Evaluate → Adapt →
Continue, modelled as explicit state in `lib/types.ts`, not one long prompt.
A learner can go from a topic or upload to a scored, personalised report
through this loop without leaving the app. Deep dive with a real adaptation
trace: [07 — Prompt and agent architecture](07-prompt-agent-architecture.md).

## 2. Learn from an upload or a bare topic

PDF, DOCX, PPTX, TXT and Markdown are parsed into a structure-preserving
document (`lib/documents/`), chunked with heading breadcrumbs and page
numbers preserved for citation, embedded locally, and retrievable by hybrid
BM25 + dense search. A topic with no upload plans and teaches from the
model's general knowledge instead — same loop, same UI, no separate code
path the learner has to know about. See
[06 — RAG implementation](06-rag-implementation.md).

## 3. A lesson plan that is a real plan, not a template

`deriveStructure()` (`lib/teach/plan.ts`) changes lesson *structure* on two
independent axes — the requested duration (5 min → the single essential idea
only; 20 min → 2–5 sequenced concepts with examples; 60 min → 4–10 concepts
plus an explicit practice/consolidation concept before assessment) and the
requested depth (a 0.7×/1×/1.3× concept-count multiplier plus prompt
guidance: `overview` skips derivations, `deep` asks for the underlying
mechanism and technical terminology) — and sequences concepts by a real
topological sort over model-proposed prerequisites, so Ohm's Law is never
taught before current and voltage. See
[08 — Personalisation approach](08-personalisation-approach.md).

## 4. Subject-aware visual selection, shown to the learner

The planner classifies every concept's subject and picks a visual kind from
an explicit, inspectable lookup table (`SUBJECT_VISUAL_RULES` in
`lib/teach/script.ts`) — never an LLM guess — and the UI shows the *reason*
next to the choice (`VisualSpec.rationale`), directly answering the spec's
"demonstrate how the system decides." Full table and worked examples per
subject: [12 — Avatar and video generation approach](12-avatar-video-generation.md#subject-aware-visual-selection).

## 5. Checkpoint questions that actually gate progress

Every concept ends in a checkpoint — MCQ, short-answer, problem-solving,
application, or "explain in your own words" — answered by typing or by real
speech (Sarvam STT). The lesson player renders it as an interactive question,
not baked into the video, and a wrong answer visibly interrupts the lesson
rather than sliding past it.

## 6. Misconception-named evaluation, not a pass/fail mark

`evaluate.ts`'s zod schema *requires* a named misconception (label +
description) on anything short of "correct" — a `.refine()` makes "just
wrong" fail to validate. An exact MCQ match to the reference answer
short-circuits to a deterministic "correct" without a model call at all,
since there's nothing to judge.

## 7. Adaptation that changes the explanation, not just the verdict

A wrong answer triggers `adapt.ts`: a re-explanation with an analogy that is
structurally guaranteed different from every analogy already used on this
concept this session (tracked in `concept_adaptation_state`, checked in
code, retried once if the model reuses a banned one anyway), a new worked
example, a fresh checkpoint at an adjusted difficulty, and — on a second
consecutive miss — a drop to the concept's prerequisite instead of a third
attempt at the same content. This is the single feature the spec weights
highest (20/100, "Human-Like Teaching and Adaptation").

## 8. Multilingual, including mid-lesson switching

Eleven languages including English, Hindi, Hinglish and eight more Indian
languages; a lesson can be requested in one language and switched mid-lesson
by asking naturally ("ab hindi mein samjhao"), verified live, with lesson
state and scene position untouched by the switch. Material in one language
and teaching in another works both ways. See
[10 — Multilingual implementation](10-multilingual-implementation.md).

## 9. A real generated teaching video, not a slideshow with narration

Real Sarvam TTS narration, an animated SVG avatar lip-synced to the actual
audio amplitude envelope (blinking, head sway, an emphasis gesture — not a
static portrait), and a subject-appropriate visual sharing the frame with
on-screen captions, captured frame-by-frame in headless Chromium and muxed by
`ffmpeg` into a downloadable MP4. See
[12 — Avatar and video generation approach](12-avatar-video-generation.md).

## 10. Anti-hallucination that's enforced in code, not requested in a prompt

When nothing retrieved clears a code-enforced cosine-similarity threshold,
the system says the material doesn't cover the question rather than guessing
— gated on a computed boolean (`FollowUpAnswer.grounded`,
`GroundedAnswer.grounded`), not the model's own claim about itself. Verified
live against a real upload and an out-of-scope question. See
[06 — RAG implementation](06-rag-implementation.md#anti-hallucination-a-real-refusal).

## 11. A deterministic, honest assessment report

Score, concepts understood, weak areas and misconceptions held are computed
from recorded verdicts in code — never invented by the model — with only the
recommendation prose generated, grounded in those computed facts. See
[09 — Assessment methodology](09-assessment-methodology.md).

## 12. Progress that personalises the next session

A per-learner, per-concept mastery table (`concept_progress`) means a second
session on related material is genuinely shaped by the first — concepts
already mastered are covered briefly instead of re-taught from scratch,
concepts previously weak are reinforced. `/progress` shows this across every
past session.

## 13. Learning paths for broad topics

"Teach me machine learning" or an explicit multi-day request produces an
ordered, dependency-sequenced set of steps with the learner's current
position, each step's own lesson plan generated lazily when the learner
actually starts it.
