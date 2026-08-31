# Personalisation approach

Personalisation happens on three independent axes: what the learner states
about themselves, how much time they have, and what they have already
learned in past sessions with this system.

## 1. Learner profile → every prompt

`learner_profiles` (`lib/db/accessors/learners.ts`) stores level (beginner /
intermediate / advanced), prior knowledge, goal, preferred style, language,
minutes available, and depth. Every one of these is threaded into the
teaching prompts as text, not as a hidden flag: `plan.ts`'s system prompt
literally reads *"You are planning a lesson for a `{level}` learner. Goal:
`{goal}`. Preferred style: `{style}`. Prior knowledge: `{priorKnowledge}`."*
— the same for `script.ts` and `adapt.ts`. The spec's own three-tier example
(beginner: simple terminology and analogies; intermediate: technical
explanations and practical examples; advanced: detailed concepts,
mathematics, implementation detail) is realised by the model reading
`level` directly, not by three hardcoded lesson templates.

## 2. Understand: free text overrides the stored profile, field by field

A learner never fills a twelve-field form. `profile.ts`'s
`parseTeachingInstruction()` parses a free-text instruction ("teach me
Chapter 4 in 20 minutes in Hindi with simple examples") into a
`TeachingIntent`; whatever the instruction states overrides the stored
profile default, whatever it omits falls back to the profile, then to a sane
default (`level: "beginner"`, `language: "en-IN"`, `minutesAvailable: 20`,
`depth: "standard"`). This is done via `sarvam-105b`, not regex, specifically
because "give me the short version, I only have till my next class" is
understandable but does not match any fixed pattern.

## 3. Time changes lesson *structure*, not just length

`deriveStructure(totalMinutes, depth)` (`lib/teach/plan.ts`) — a pure
function, no model call:

| Duration | Bucket | Concept count | Structure |
|---|---|---|---|
| ≤ 7 min | `essential` | 1 | the single essential idea only |
| ≤ 25 min | `structured` | `clamp(round(minutes/6), 2, 5)` | several sequenced concepts, each with an example |
| > 25 min | `deep` | `clamp(round(minutes/9), 4, 10)` | more concepts **plus an explicit practice/consolidation concept** appended before the final assessment |
| explicit multi-day/multi-session | — | — | routed to `lib/teach/path.ts` instead — one lesson per session, spaced by dependency |

`depth` then applies a **second, independent** multiplier to that concept
count — `overview` ×0.7 (and the prompt is told to skip derivations/proofs),
`standard` ×1 (no extra guidance), `deep` ×1.3 (and the prompt is told to
include the underlying derivation/mechanism, precise terminology and
implementation detail) — clamped to 1–12 overall. A 20-minute `overview`
lesson and a 20-minute `deep` lesson on the same topic therefore produce a
genuinely different number and character of concepts, not the same lesson
read faster or slower.

Per-concept time budgets are then allocated proportionally to each concept's
model-assigned difficulty (`timeBudgetSeconds`), so a harder concept in the
plan gets more of the total time, not an even split.

## 4. Depth also changes how each concept is taught

`script.ts`'s `DEPTH_GUIDANCE` (referenced via `plan.ts`'s prompt) is the
prose instruction that turns the depth multiplier into actual content
difference: overview lessons are told to keep summaries and examples brief
and skip derivations; deep lessons are told to go into the underlying
mechanism, precise technical terminology, and implementation-level detail —
matching the spec's own beginner/intermediate/advanced example almost
verbatim, but driven by the learner's stated `depth`, not a hardcoded
three-way branch.

## 5. Style shapes tone, not structure

`style` ("simple examples and analogies", "example-driven",
"exam-focused") is passed straight into every scripting and adaptation
prompt as *"Preferred style: `{style}`."* — it influences the register and
kind of examples chosen without changing the loop's structure.

## 6. Cross-session personalisation: a second lesson is shaped by the first

`concept_progress` (`lib/db/accessors/conceptProgress.ts`) is a per-learner,
per-concept mastery table, upserted every time a concept is checkpointed or
quizzed (`recordVerdictProgress()` in `assess.ts` — see
[09](09-assessment-methodology.md) for the exact blending formula). When
planning a new lesson, `planLessonConcepts()` passes this learner's
`priorProgress` into `plan.ts`, whose prompt is told explicitly: *"Already
mastered from a prior session (cover briefly, don't re-teach from scratch):
`{mastered}`. Previously weak, reinforce if relevant here: `{weak}`."* This
is what makes a second session on related material genuinely different from
teaching a stranger — the plan itself changes shape based on what this
specific learner has already shown they know.

## 7. Difficulty moves within a session too

Every `AnswerEvaluation` carries a `difficultyAdjustment` (-1/0/+1). A
correct answer nudges the next question harder; a wrong one nudges it
easier, computed in `adapt.ts`'s `clampDifficulty()` (bounded 1–5) — so
difficulty is not fixed at plan time, it tracks in-session performance.

## What personalisation deliberately does not do

- **Learning-path step completion is not tracked automatically** (see
  [16](16-known-limitations.md)) — the per-learner mastery table above still
  updates from any session, path or not, but a path's own progression needs
  a caller this slice doesn't yet have.
- **`lib/teach/path.ts` step titles/summaries are not translated** into the
  learner's teaching language — they are navigational metadata, not taught
  content; each step's actual lesson plan is fully multilingual once
  generated.
