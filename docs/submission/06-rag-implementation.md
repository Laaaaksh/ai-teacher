# RAG implementation

Sarvam has no embeddings endpoint (verified live: 404). Retrieval is
therefore hybrid and entirely local except for the final answer generation
call: BM25 lexical scoring fused with local dense embeddings, gated by a
code-enforced relevance threshold before any model is asked to answer.

## Pipeline

```
Upload -> parseDocument() -> chunk() -> embed() -> BM25 index (in-memory, per query)
                                            |
Question -> [translate query if cross-language] -> retrieve() (BM25 + dense, RRF)
                                            |
                                    isRelevant()? --no--> honest refusal (no model call)
                                            |yes
                                    ground() / ask() -> sarvam-105b answers ONLY from
                                                         the retrieved excerpts, cites them
```

- **Parsing** (`lib/documents/`): PDF/DOCX/PPTX/TXT/Markdown into a
  structure-preserving `ParsedDocument` (document → sections/pages →
  paragraphs), keeping real page numbers for PDFs (one section per page,
  not one concatenated string) and heading levels for DOCX/Markdown, so
  every chunk keeps one unambiguous citation.
- **Chunking** (`lib/rag/chunk.ts`): overlaps chunks across a semantic
  boundary — whole trailing paragraphs carried forward, never a mid-sentence
  cut — and builds a heading breadcrumb ("Chapter 4 > Ohm's Law") from real
  heading levels.
- **Embedding** (`lib/rag/embed.ts`): `Xenova/all-MiniLM-L6-v2`, 384-dim,
  mean-pooled, L2-normalized, entirely local. Computed once per chunk and
  cached in `document_chunks.embedding` (a Float32 BLOB) — reopening an
  already-indexed document is instant. Indexing runs in batches, updates the
  DB after each batch (progress survives a crash), and is idempotent
  (re-running only embeds chunks still missing a vector).
- **Lexical scoring** (`lib/rag/bm25.ts`): hand-rolled, no dependency,
  Unicode-aware tokenizer (including combining marks, so Devanagari and
  similar scripts tokenize correctly).
- **Hybrid retrieval** (`lib/rag/retrieve.ts`): BM25 rank and dense cosine
  rank fused by **Reciprocal Rank Fusion**, not weighted score blending —
  RRF only needs each method's rank order, which sidesteps BM25 and cosine
  similarity living on incomparable, corpus-dependent scales. Each result
  keeps its raw `denseScore` (the actual cosine, not the fused rank)
  specifically for the relevance gate below.
- **Cross-language retrieval** (`lib/rag/language.ts`): MiniLM is
  English-tuned, so a Hindi query embedded directly against English chunks
  (or the reverse) scores near-random, and BM25 has zero token overlap
  across scripts. The fix translates the **query** — not the corpus — into
  the document's detected language via Sarvam's real `/translate` before
  retrieval; retrieved excerpts stay in their source language, and
  `sarvam-105b` reads them directly and writes the answer in whatever
  language the learner asked in, in one chat call. Document language is
  detected once at index time from Unicode script ranges and stored on
  `documents.language`.
- **Chapter/concept outline extraction** (`lib/rag/outline.ts`): chapter
  boundaries come free from structure (DOCX/Markdown headings, a "Chapter
  N"/"Unit N" marker for PDF/PPTX); concepts, definitions and worked
  examples inside each chapter need real reading comprehension, so that part
  is one model call per chapter, generated lazily on first request and
  cached.

## Anti-hallucination: a code-enforced gate, not a prompt request

`lib/rag/ground.ts`'s `isRelevant()` checks the **best raw cosine similarity**
in the retrieved set against `DENSE_RELEVANCE_THRESHOLD` (currently `0.32`,
tuned empirically against `evals/fixtures/` — see `evals/README.md`) *before*
the model is ever asked to answer. This is deliberate: `sarvam-105b`'s
pretraining almost certainly "knows" facts like Ohm's Law regardless of what
a specific uploaded document says, so whether to refuse cannot be left to the
model's own judgement about whether to comply with a system prompt — it has
to be decided in code from a number the model never sees or controls. The
gate reads the *maximum* across all retrieved chunks rather than the top
fused-rank result, because RRF's fused order can rank a weaker dense match
first.

The same contract is exposed to callers as a **computed boolean**
(`GroundedAnswer.grounded` / `FollowUpAnswer.grounded`), not the model's own
wording — so a UI or a grading harness can always tell a grounded answer from
a general-knowledge one regardless of how the model phrased its response.

### A real grounded answer, with citations

Run live against `evals/fixtures/electricity-basics.pdf`, uploaded and
indexed through this app's own `/api/documents` and `/api/documents/[id]/index`
endpoints, then asked through `POST /api/rag/ask`:

> **Question:** What is Ohm's Law and how does resistance relate to current?
>
> **Answer:** Ohm's Law states that the current through a conductor between
> two points is directly proportional to the voltage across the two points,
> and inversely proportional to the resistance between them. [1] It is
> written as V = I times R, where V is voltage, I is current, and R is
> resistance. [1]
>
> According to the excerpts, resistance and current have an inverse
> relationship; specifically, current is inversely proportional to the
> resistance. [1] This means that if resistance increases while voltage
> stays constant, the current decreases, not increases. [1]
>
> **Citations returned:** page 2 ("Chapter 2: Resistance and Ohm's Law..."),
> page 1 ("Chapter 1: Current and Voltage..."), page 3 ("Chapter 3: Circuits
> and Kirchhoff's Laws..."). `grounded: true`.

### Anti-hallucination: a real refusal

Same document, a question it does not cover, same live run:

> **Question:** What year did the French Revolution begin?
>
> **Answer:** *"I couldn't find anything about that in the uploaded
> material, so I won't guess — this document doesn't seem to cover that."*
>
> `grounded: false`, `citations: []`. No model call was even made to answer
> the question — the gate refused before generation.

## Two retrieval seams for two different callers

- **`ground()`** (`lib/rag/ground.ts`): hard-refuses when nothing clears the
  gate. Used by `POST /api/rag/ask`, the standalone retrieval demo at
  `/rag-demo`.
- **`ask.ts`**'s follow-up handler: does **not** hard-refuse an off-document
  question — a real teacher asked something outside the textbook says "that's
  not in your book, but here's the answer" rather than refusing outright. It
  still computes and returns the same `grounded` boolean so the UI can label
  the answer honestly either way; the spec asks to minimize *unsupported*
  information, not to refuse everything off-document. See
  [07 — Prompt and agent architecture](07-prompt-agent-architecture.md).

## Known limitations of this slice

- **Transliterated Hinglish queries** ("karant kya hota hai" for "what is
  current") have zero token overlap with English chunks for BM25, and MiniLM
  does not recognise transliterated Hindi as equivalent to the English word
  — so a query whose key nouns are Latin-script Hindi (not real Devanagari)
  is correctly-but-unhelpfully treated as unrelated. Verified live: real
  Devanagari Hindi ("विद्युत धारा क्या है?") retrieves correctly against
  English material; transliterated-only Hinglish for a term with no English
  cognate in the query does not. A transliteration step (Latin Hindi →
  Devanagari before the existing translate path) would fix this; out of
  scope here.
- **`lib/teach/plan.ts` grounds a lesson plan by feeding the model up to
  ~16,000 characters of raw chunk text**, not a further semantic retrieval
  pass — fine for a typical chapter, truncated rather than intelligently
  summarized for a very long or un-sectioned document.
- **Outline extraction prefers the original upload on disk**
  (`data/uploads/`, gitignored) since re-parsing the source file gives real
  paragraph/heading boundaries; if that file is missing, it falls back to
  rebuilding a usable-but-not-exact outline from the document's already-
  embedded chunks, and only returns 409 when neither the file nor any
  chunks exist.
- Full list, including the PDF chapter-title truncation edge case
  reproduced by the eval fixture itself: `docs/ARCHITECTURE.md`'s Known
  limitations.

## How this is actually checked, not just asserted

`npm run eval:rag` (`evals/retrieval-eval.ts`) runs a real end-to-end quality
check against `evals/fixtures/electricity-basics.pdf` and the live Sarvam
API — deliberately kept out of `npm test` because it costs real API calls
and network. See `evals/README.md` for what it checks and how
`DENSE_RELEVANCE_THRESHOLD` was tuned.
