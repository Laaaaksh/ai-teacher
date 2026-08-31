# Prompt and agent architecture

## Design principle: state machine, not one long prompt

The teaching loop — **Understand → Plan → Explain → Demonstrate → Question →
Evaluate → Adapt → Continue** — is implemented as one module per stage under
`lib/teach/`, each with its own narrow zod schema, its own prompt, and its
own persisted output in `lib/types.ts`. No single prompt is asked to "be the
teacher" end to end. This matters for two concrete reasons, both discovered
by actually running the system against the live API rather than assumed:

1. **`sarvam-105b` is a reasoning model whose reasoning cost is prompt-driven,
   not fixed.** A large, do-everything prompt reasons more and is more likely
   to blow a `max_tokens` budget before writing any `content`. Splitting a
   concept's scripting into two independent calls (introduction+explanation,
   then example+checkpoint+transition), fired via `Promise.all`, costs no
   wall-clock time while roughly halving each call's schema complexity — see
   [05 — AI/ML models used](05-ai-ml-models.md) for the measured numbers
   behind this.
2. **A judge, or a debugger, needs to see which stage did what.** Because
   each stage is a typed function with a typed return value persisted to its
   own table, a wrong evaluation, a bad plan, or a reused analogy is
   traceable to one function, not buried inside one 2,000-word transcript.

## The eight stages, with the file and function that owns each one

| Stage | Module : function | Model call? | What it produces |
|---|---|---|---|
| **Understand** | `profile.ts` : `parseTeachingInstruction()` | Yes | Free text → structured `TeachingIntent` (topic, level, language, minutes, depth, style, wants-questions/assessment). Also `detectLanguageSwitch()` for mid-lesson requests. |
| **Plan** | `plan.ts` : `planLesson()` | Yes | Topic or document chunks → ordered `Concept[]`, each with a subject, difficulty, time budget, default visual, and citations. `deriveStructure()` (no model call — pure function) decides concept count and structure from duration + depth. |
| **Explain / Demonstrate / Question** | `script.ts` : `scriptConcept()` | Yes (×2, parallel) | One concept → introduction, explanation (with a named analogy), worked example, checkpoint question, transition — each beat's visual chosen by `chooseVisualKind()` (no model call — a lookup table). |
| **Evaluate** | `evaluate.ts` : `evaluateAnswer()` | Yes (usually) | A student's answer → `correct`/`partial`/`incorrect` **plus a required named misconception** on anything short of correct. An exact MCQ match short-circuits to `correct` with no model call — nothing to judge. |
| **Adapt** | `adapt.ts` : `adaptAfterIncorrectAnswer()` | Yes | A wrong/partial answer → a re-explanation with a **structurally different** analogy, a new example, a fresh question at adjusted difficulty, or a drop to the prerequisite on a second consecutive miss. |
| **Continue — follow-ups** | `ask.ts` : `answerFollowUpQuestion()` | Yes | A mid-lesson interruption → a grounded-or-general-knowledge answer (never touches lesson position), or a detected language switch. |
| **Continue — assessment** | `assess.ts` : `generateFinalQuiz()`, `generateAssessmentReport()` | Yes | Taught concepts → a final quiz, then a report whose score/weak-areas/misconceptions are **computed in code from recorded verdicts**, never invented by the model. |
| **Continue — paths** | `path.ts` : `generateLearningPath()` | Yes | A broad/multi-day request → an ordered, dependency-sequenced `LearningPathStep[]`. |

Orchestration (`session.ts`) wires Plan → Explain/Demonstrate/Question into
the plan/persist split described in
[04 — System architecture](04-system-architecture.md), and every one of the
above calls routes through `lib/teach/llm.ts` rather than the Sarvam client
directly — a shared bounded retry specifically for malformed/truncated
responses, on top of `lib/sarvam`'s own JSON-repair retry.

## Prompt-engineering patterns used throughout

- **Every structured prompt spells out the exact JSON shape.** Verified
  live: `response_format: json_object` guarantees valid JSON but not the
  caller's field names — a prompt that only *described* the desired fields
  in prose came back with a plausible-but-wrong shape
  (`description`/`bucket`/`examples` instead of the actual schema). Every
  `lib/teach` prompt ends with an explicit
  `"Respond with ONLY a JSON object of exactly this shape: {...}"` block
  naming every key.
- **Language is named in words, not passed as a bare code.** `"en-IN"` alone
  was not a reliable instruction — verified live, the model sometimes wrote
  Hindi despite it. `languageInstruction()` (`profile.ts`) turns a code into
  `"Write in English (language code \"en-IN\").")` and every prompt routes
  through it.
- **Structural rules are enforced in code, not just requested in the
  prompt.** The clearest example is `adapt.ts`'s banned-analogy list: the
  model is told never to reuse an analogy, but the result is also *checked*
  against the list of every analogy already spent on this concept, and one
  repair round is fired — explicitly naming the repeat — if the model
  reuses one anyway. "Ask nicely" is backed by "verify and retry."
- **The spec's own worked example is embedded directly into the evaluation
  prompt.** `evaluate.ts`'s system prompt literally includes: *"if asked
  what happens to current when resistance increases at constant voltage and
  the student says 'current increases', the misconception is a specific
  inverse-relationship confusion (Ohm's Law: I = V/R), not just 'incorrect
  answer'."* This is not decoration — the live trace below is exactly that
  scenario, run for real.
- **Deterministic facts are computed in code and only *phrased* by the
  model.** `assess.ts`'s report generation computes score, weak areas,
  concepts understood and misconceptions held from recorded verdicts before
  the model is ever called; the model's only job is the 1–2 sentence
  recommendation, explicitly instructed to base it "ONLY on the weak
  areas/misconceptions given below — don't invent problems that weren't
  found."

## A real adaptation trace

This is not a scripted example. It is the actual output of a live run
against the real Sarvam API during this documentation's own writing, on a
freshly generated lesson plan for the topic "Electricity: Ohm's Law" — the
exact scenario the assessment brief itself uses as its worked example (see
section 12 of the brief: *"Teacher: What happens to current if resistance
increases while voltage remains constant? Student: Current increases."*).

**The concept as originally taught** (`script.ts`'s `scriptConcept()`), for a
beginner learner:

> **Explanation** (analogy: a school-corridor rush): *"Ohm's Law tells us
> that voltage (V) is the push that drives electrons, current (I) is the
> flow of those electrons through a circuit, and resistance (R) is anything
> that fights that push... Think of a narrow school corridor during a
> free-period rush... If the staircase is clogged with bags, the same push
> produces a smaller flow, so the current drops."*
>
> **Worked example** (a 12V/4Ω → 3A, then 12V/6Ω → 2A water-tank analogy):
> *"Suppose a 12-volt battery is connected to a lamp that puts up 4 ohms of
> resistance. Using I = V / R, we get I = 12 ÷ 4 = 3 amperes. Now imagine the
> lamp gets old and its resistance climbs to 6 ohms... The same push now
> produces only 2 amperes."*
>
> **Checkpoint question:** *"If the resistance of a circuit is doubled while
> the voltage across it stays exactly the same, what happens to the current
> flowing through it?"* — MCQ: *It stays the same / It doubles / It halves /
> It drops to zero.*

**The wrong answer submitted** (`POST /api/teach/sessions/:id/answer`):

> *"It doubles, because more resistance means more current is needed to push
> through it."*

**`evaluate.ts`'s live response:**

```json
{
  "verdict": "incorrect",
  "misconception": {
    "label": "Inverse relationship confusion",
    "description": "The student mistakenly believes that increasing resistance causes current to increase, treating resistance and current as directly proportional. In reality, Ohm's Law (I = V/R) shows that current is inversely proportional to resistance when voltage is held constant.",
    "relatedConceptId": "089b2e64-...-089b2e64"
  },
  "feedback": "When resistance doubles while voltage stays the same, current halves, not doubles. According to Ohm's Law, current equals voltage divided by resistance (I = V/R). If R becomes 2R and V remains fixed, I becomes V/(2R), which is half the original value. Think of resistance as a narrow pipe: the same water pressure (voltage) pushes less water (current) through a thinner pipe, not more.",
  "difficultyAdjustment": -1
}
```

This is exactly the spec's own scenario, reproduced live and evaluated
correctly: not "incorrect," but a *named* misconception — an inverse
relationship mistaken for a direct one — with a description precise enough
that the next stage can target it specifically.

**`adapt.ts`'s live re-explanation**, banned from repeating either the
"school corridor" or "water tank" analogies already spent on this concept
(`concept_adaptation_state`), and told the specific misconception to address:

> *"You think adding more resistance lets more current through, but it
> actually lets less through. Picture a stadium exit with turnstiles. The
> fans waiting in line do not change — that is your voltage, the steady
> push. If most turnstiles are open, the crowd drains out quickly; that is
> low resistance and high current. If you close half the turnstiles, the
> same crowd piles up at the narrow opening; that is higher resistance and
> the number exiting each minute drops. Current falls. Here is a concrete
> number example: a 12-volt battery pushes electrons through a thin wire
> with 3 ohms of resistance. That gives 4 amps of current (12 divided by 3
> equals 4). If you double the wire's resistance to 6 ohms while the battery
> still supplies 12 volts, only 2 amps flow (12 divided by 6 equals 2). The
> push stayed the same, but the roadblock doubled, so the flow was cut in
> half. Resistance chokes the flow; it does not squeeze more current
> through."*

A genuinely different domain (a stadium exit, not a corridor or a water
tank), a **new** worked example with different numbers (12V/3Ω → 4A, then
6Ω → 2A — not a repeat of the original 4Ω/6Ω pair), and a fresh, easier
follow-up question (`difficultyAdjustment: -1` applied):

> *"With the same battery voltage, if you make the resistance smaller, does
> the current get bigger or smaller?"* — MCQ: *Bigger / Smaller / Same /
> Zero.*

The response also returned a new `checkpointScene` (order 17, appended after
the original lesson's last scene) so the lesson player has something to
render for the re-question — the adaptation is a real, playable continuation
of the lesson, not just a text explanation.

**What made this structurally impossible to fake as a repeat**:
`concept_adaptation_state.used_analogies_json` was seeded at scripting time
with `"school corridor rush"`, and the checkpoint-explanation's analogy was
added to it before this call — so even this *first* re-explanation had two
banned analogies to avoid, checked by string comparison against the model's
`analogyLabel` output, not merely requested in the prompt.

## Follow-up questions and mid-lesson language switching

`ask.ts`'s `answerFollowUpQuestion()` first checks whether the message is
actually a language-switch request (`detectLanguageSwitch()`) before treating
it as a question — verified live in the same session:

> **Message:** *"ab hindi mein samjhao"*
>
> **Response:** *"Sure — switching to Hindi (Devanagari script) now."*
> `languageSwitchRequested: "hi-IN"`, and the session's `language` column
> was updated to `hi-IN` in the same request — without touching
> `current_scene_order`, so the lesson resumes exactly where it was. See
> [10 — Multilingual implementation](10-multilingual-implementation.md) for
> the full multilingual trace.

An ordinary interruption, same session, before the switch:

> **Question:** *"Why does resistance oppose current at all — what is
> physically happening inside the wire?"*
>
> **Answer:** *"Electrons flowing through a wire crash into the metal's
> atoms and impurities. These collisions slow the electrons down and turn
> electrical energy into heat. Because of these repeated crashes, the wire
> resists the flow; more crashes means higher resistance and less current
> for the same voltage."* `grounded: false` (this session had no uploaded
> material, so the answer is correctly labelled general knowledge rather
> than a fabricated citation).
