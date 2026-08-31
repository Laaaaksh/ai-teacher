# AI Teacher — submission documentation

Written for the jury, against Section 20 of the Round 2 Technical Assessment
("Project Documentation"), in the order that section lists. Every concrete
claim — every quoted lesson, misconception, adaptation, translation, latency
figure, and test count — was verified against this repository and the live
Sarvam API while this documentation was written, not written from memory of
the design. Where something doesn't work, or works only partway, that is
stated in [16 — Known limitations](16-known-limitations.md) rather than
implied to be complete.

Start with [02 — Solution overview](02-solution-overview.md) for the
five-minute version, then
[07 — Prompt and agent architecture](07-prompt-agent-architecture.md#a-real-adaptation-trace)
for the single most persuasive piece of evidence in this document: a real,
live-run trace of a student answering wrong, the system naming the exact
misconception, and re-teaching with a genuinely different analogy.

1. [Problem statement](01-problem-statement.md)
2. [Solution overview](02-solution-overview.md)
3. [Key features](03-key-features.md)
4. [System architecture](04-system-architecture.md)
5. [AI/ML models used](05-ai-ml-models.md)
6. [RAG implementation](06-rag-implementation.md)
7. [Prompt and agent architecture](07-prompt-agent-architecture.md) — includes the real adaptation trace
8. [Personalisation approach](08-personalisation-approach.md)
9. [Assessment methodology](09-assessment-methodology.md)
10. [Multilingual implementation](10-multilingual-implementation.md)
11. [Voice implementation](11-voice-implementation.md)
12. [Avatar and video generation approach](12-avatar-video-generation.md) — includes the subject-visual decision table
13. [APIs and third-party services](13-apis-third-party-services.md)
14. [Setup instructions](14-setup-instructions.md)
15. [Deployment instructions](15-deployment-instructions.md)
16. [Known limitations](16-known-limitations.md)

## Where the deeper engineering reference lives

This submission documentation is written for a jury deciding whether the
system genuinely does what it claims. For implementation-level detail beyond
that — every accessor function, every migration, every renderer's exact
content contract — the repository's own engineering docs are the
authoritative source and are linked from throughout this set:

- `docs/ARCHITECTURE.md` — the settled system architecture, written
  alongside the build itself
- `docs/SCHEMA.md` — the full database schema, table by table
- `docs/VIDEO.md` — the video-generation pipeline in full
- `AGENTS.md` — non-obvious setup facts and the codebase's own structure map

## A note on how this was written

Every session, document upload, question, wrong answer, language switch, and
video render described in this documentation was actually run against a
clean checkout of this branch and the live Sarvam API — see
[14 — Setup instructions](14-setup-instructions.md) for the exact commands
and measured timings from that run. Nothing quoted here is invented or
back-filled from the design; where a number isn't cited, it wasn't measured,
and this documentation says so rather than guessing.
