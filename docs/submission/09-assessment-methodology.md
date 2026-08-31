# Assessment methodology

Two distinct evaluation moments exist, and they share the same deterministic
scoring machinery: an **in-lesson checkpoint** after every concept, and a
**final quiz** at the end of the lesson. Both produce an `AnswerVerdict`
(`correct`/`partial`/`incorrect`) via `lib/teach/evaluate.ts`; only the final
quiz additionally rolls those verdicts up into a persisted
`AssessmentReport`.

## Question generation

- **Checkpoints** (`script.ts`'s `scriptConcept()`): one per concept, mixed
  type (mcq / short-answer / problem-solving / application /
  explain-in-own-words), generated alongside that concept's worked example
  so the question and the teaching stay coherent — and explicitly instructed
  not to reuse the explanation's own derivation as its visual, so the
  checkpoint doesn't hand the learner the answer next to the question
  testing it.
- **Final quiz** (`assess.ts`'s `generateFinalQuiz()`): `min(8, max(3,
  conceptCount))` questions covering every taught concept, mixed type and
  difficulty, **weighted toward concepts the learner struggled with at
  checkpoints** (`emphasizeConceptTitles`, passed by the session route from
  the actual checkpoint history) — a learner who missed Ohm's Law mid-lesson
  gets asked about it again at the end, not just once.

## Evaluation: never just a verdict

`evaluate.ts`'s zod schema requires a misconception (label + description) on
anything short of `correct` — enforced by a `.refine()` that makes a
response fail validation if the verdict isn't `correct` and either field is
missing. This is the mechanism, not just an instruction: the model cannot
produce a valid "wrong, no reason given" response even if it tried.

The one deliberate shortcut: an **exact MCQ match** to the reference answer
short-circuits to `correct` without a model call — there's nothing to judge,
and skipping it avoids adding latency and a (small) hallucination surface to
an already-unambiguous case.

## Scoring: computed in code, phrased by the model

`assess.ts` is explicit about the split:

- **`computeScore()`**: `correct = 100`, `partial = 50`, `incorrect = 0`
  points, averaged across the learner's *latest* verdict per concept (a
  concept quizzed more than once keeps only its final result — what the
  learner knows now, not their first attempt).
- **Weak areas / concepts understood / misconceptions held**: filtered
  directly from recorded verdicts — `weakAreas` is every concept whose
  latest verdict wasn't `correct`, `misconceptionsHeld` is every named
  misconception attached to a non-correct verdict. The model never invents
  these; it only sees a summary of numbers already computed and is
  instructed to *"base the recommendation ONLY on the weak areas/
  misconceptions given below — don't invent problems that weren't found."*
- **`recommendedRevision` / `suggestedNextTopic`**: the only two fields the
  model actually writes — 1–2 sentences of prose, grounded in the computed
  facts above.

This maps directly onto the spec's own example report format:

```
Topic: Electricity
Score: 80%
Strong Areas: Current, Voltage
Needs Improvement: Resistance, Ohm's Law
Recommendation: Revise Ohm's Law and complete two additional practice problems.
```

— `score` ← `computeScore()`, `Strong Areas` ← `conceptsUnderstood`, `Needs
Improvement` ← `weakAreas`, `Recommendation` ← the model's grounded prose.

## Mastery tracking: half-life blending, not overwrite

`recordVerdictProgress()` is the **one** function both the checkpoint path
(`/answer`) and the final-quiz path (`/assess/submit`) call to update
`concept_progress` — so there is exactly one place that decides what a
verdict does to a learner's tracked mastery, not two independently-drifting
implementations. The blend is deliberately not "just take the latest score":

```
masteryScore = previousScore === undefined
  ? points                                   -- first time this learner is scored on this concept
  : round(previousScore * 0.5 + points * 0.5) -- otherwise, half history, half this answer
```

so a single lucky or unlucky answer moves the tracked mastery without
erasing everything the learner has previously demonstrated.
`deriveMastery(score)` then buckets that number into
`not-started`/`struggling`/`developing`/`proficient`/`mastered` (thresholds:
0, >0, ≥40, ≥70, ≥90), which is what `/progress` and future lesson planning
(see [08 — Personalisation approach](08-personalisation-approach.md)) read.

## Idempotency: a known gap, disclosed

`POST /api/teach/sessions/[id]/assess` is **not idempotent** — every call
generates and persists a fresh question set, with no check for or reuse of a
previously issued quiz. This is called out plainly in
[16 — Known limitations](16-known-limitations.md) rather than hidden;
`assess/submit`'s `submittedCount`/`scoredCount`/`droppedQuestionIds`
response fields exist specifically so a learner answering from an orphaned
question batch (e.g. after a client retry) gets a visible discrepancy
instead of a silently wrong score, which is the practical mitigation for a
schema change (tagging quiz questions with the session id) that was
deliberately not attempted under the build's time constraint.
