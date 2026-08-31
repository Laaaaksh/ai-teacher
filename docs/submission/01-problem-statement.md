# Problem statement

Traditional digital learning is either a pre-recorded lecture (fixed pace, fixed
depth, fixed language, no interaction) or a text chatbot (answers questions but
never plans a lesson, never checks understanding, never adapts). Neither behaves
like a teacher.

The brief (Bharat Academix AI Innovation Hackathon 2026, Round 2 — "AI Teacher:
Build a Human-Like AI Educator That Teaches Through Video") asks for a system
that takes an uploaded book, textbook, PDF, notes, presentation, research paper,
or a bare topic, and turns it into a personalised teaching session: the system
must understand the learner, plan a lesson, explain concepts, ask questions,
evaluate answers, identify misconceptions, adapt its teaching, and present all
of it through a generated video with a human-like avatar and voice — not a
question-answering surface bolted onto a document.

The spec states twice, in bold, what does **not** count as a solution:

> A basic chatbot, a static video, or a talking avatar reading a generated
> script will not be considered equivalent to an adaptive AI Teacher.

Concretely, the system has to demonstrate, not just claim:

- **Understanding** material it hasn't seen before (arbitrary uploads) or a
  bare topic, including grounding its answers in that material and refusing
  to fabricate when the material doesn't cover something.
- **Planning** a lesson whose structure — not just its length — changes with
  the time available (5 minutes vs. 20 minutes vs. 60 minutes) and the
  learner's level, goal, prior knowledge, and requested depth.
- **Teaching**, not reciting: explanation, a worked example, a checkpoint
  question, evaluation of the answer, and — when the answer is wrong — a
  genuinely different re-explanation, not a repeat.
- **Diagnosing**, not just scoring: a wrong answer needs a named
  misconception, because "you got it wrong" and "you think resistance and
  current are directly proportional" call for different next steps.
- **Presenting** as a real video experience — spoken narration, an animated
  avatar, and a visual chosen for the subject (an equation for maths, a
  diagram for physics, code for programming) — not a slideshow with a voice
  under it.
- **Speaking** more than one language, including switching mid-lesson on a
  natural request ("ab hindi mein samjhao"), and teaching in a language
  different from the uploaded material's own language.

This repository is one concrete attempt at that system, built against a hard
constraint worth stating up front: the only AI credential available is a
[Sarvam AI](https://www.sarvam.ai) API key — no OpenAI, Anthropic, ElevenLabs,
HeyGen, D-ID, or any avatar-generation service. Every capability described in
this documentation had to be built on Sarvam's chat, TTS, translate and STT
endpoints plus local, key-free computation (SQLite, a local embedding model,
ffmpeg, headless Chromium). See
[05 — AI/ML models used](05-ai-ml-models.md) and
[13 — APIs and third-party services](13-apis-third-party-services.md) for the
exact inventory that constraint produced.
