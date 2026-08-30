/**
 * Retrieval quality check against a real committed fixture
 * (evals/fixtures/electricity-basics.pdf) — not a mock. It parses and
 * chunks the real PDF, embeds it with the real local MiniLM model, and
 * runs the real BM25+dense hybrid retrieval for a handful of real
 * questions with known-correct expected source pages, plus one question
 * the fixture does NOT cover (checking the anti-hallucination gate) and
 * one cross-language question (checking English-material → Hindi-query
 * retrieval, which needs SARVAM_API_KEY for the query translation — see
 * lib/rag/language.ts).
 *
 * Run with: npm run eval:rag
 *
 * This is deliberately separate from `npm test`: it downloads and runs a
 * real embedding model (a first run needs network to fetch ~23MB of ONNX
 * weights, then caches them) and takes several seconds, which doesn't
 * belong in the fast, network-free default test suite.
 */
import path from "node:path";
import { readFile } from "node:fs/promises";

process.env.DB_PATH = ":memory:";

async function main() {
  const { parseDocument } = await import("../lib/documents");
  const { chunkForRetrieval } = await import("../lib/rag/chunk");
  const { saveDocument } = await import("../lib/db/accessors/documents");
  const { indexDocument } = await import("../lib/rag/embed");
  const { retrieve } = await import("../lib/rag/retrieve");
  const { ground, isRelevant, DENSE_RELEVANCE_THRESHOLD } = await import("../lib/rag/ground");
  const { SarvamError } = await import("../lib/sarvam/errors");

  const fixturePath = path.join(__dirname, "fixtures", "electricity-basics.pdf");
  const buffer = await readFile(fixturePath);
  const parsed = await parseDocument(buffer, "electricity-basics.pdf");
  const chunks = chunkForRetrieval(parsed);
  const { document } = saveDocument(parsed, chunks);

  console.log(`Parsed ${parsed.pageCount} pages into ${chunks.length} chunks. Embedding...`);
  const indexStart = Date.now();
  await indexDocument(document.id);
  console.log(`Indexed in ${Date.now() - indexStart}ms.\n`);

  interface Case {
    name: string;
    question: string;
    queryLanguage?: "en-IN" | "hi-IN";
    expectedPage?: number;
    expectRefusal?: boolean;
    requiresSarvam?: boolean;
  }

  const cases: Case[] = [
    { name: "in-scope: current definition (Ch1)", question: "What is electric current?", expectedPage: 1 },
    { name: "in-scope: Ohm's Law (Ch2)", question: "What is Ohm's Law?", expectedPage: 2 },
    {
      name: "in-scope: misconception check (Ch2)",
      question: "If resistance increases and voltage stays the same, what happens to current?",
      expectedPage: 2,
    },
    { name: "in-scope: Kirchhoff's Voltage Law (Ch3)", question: "How does Kirchhoff's Voltage Law apply to a series circuit?", expectedPage: 3 },
    { name: "out-of-scope: unrelated general knowledge", question: "What is the capital city of France?", expectRefusal: true },
    {
      name: "cross-language: Hindi query against English material (Ch2)",
      question: "ओम का नियम क्या है?",
      queryLanguage: "hi-IN",
      expectedPage: 2,
      requiresSarvam: true,
    },
  ];

  let failures = 0;
  let skipped = 0;

  for (const c of cases) {
    try {
      const retrieved = await retrieve({ documentId: document.id, query: c.question, queryLanguage: c.queryLanguage, topK: 3 });
      const topPage = retrieved[0]?.chunk.page;
      const bestDense = retrieved.reduce((max, r) => Math.max(max, r.denseScore), 0);

      if (c.expectRefusal) {
        const refused = !isRelevant(retrieved);
        console.log(`${refused ? "PASS" : "FAIL"}  ${c.name} — best denseScore=${bestDense.toFixed(3)} (threshold ${DENSE_RELEVANCE_THRESHOLD})`);
        if (!refused) failures++;
      } else {
        const ok = topPage === c.expectedPage;
        console.log(`${ok ? "PASS" : "FAIL"}  ${c.name} — expected page ${c.expectedPage}, got page ${topPage} (best denseScore=${bestDense.toFixed(3)})`);
        if (!ok) failures++;
      }
    } catch (err) {
      if (c.requiresSarvam && err instanceof SarvamError && err.kind === "config") {
        console.log(`SKIP  ${c.name} — SARVAM_API_KEY not set`);
        skipped++;
        continue;
      }
      console.log(`FAIL  ${c.name} — threw: ${(err as Error).message}`);
      failures++;
    }
  }

  console.log("\n--- grounded answer + citation check (Ch2, in-scope) ---");
  if (process.env.SARVAM_API_KEY) {
    const answer = await ground({ documentId: document.id, question: "What is Ohm's Law?", languageCode: "en-IN" });
    console.log(`grounded=${answer.grounded}, citations=${answer.citations.length}`);
    console.log(answer.answer);
    if (!answer.grounded || answer.citations.length === 0) {
      console.log("FAIL  grounded answer should be grounded with at least one citation");
      failures++;
    } else {
      console.log("PASS  grounded answer carries citations");
    }

    console.log("\n--- grounded refusal check (out-of-scope) ---");
    const refusal = await ground({ documentId: document.id, question: "What is the capital city of France?", languageCode: "en-IN" });
    console.log(`grounded=${refusal.grounded}`);
    console.log(refusal.answer);
    if (refusal.grounded) {
      console.log("FAIL  out-of-scope question should not be grounded");
      failures++;
    } else {
      console.log("PASS  out-of-scope question correctly refused");
    }
  } else {
    console.log("SKIP  grounded answer/refusal checks — SARVAM_API_KEY not set");
    skipped += 2;
  }

  console.log(`\n${cases.length + 2 - skipped} checked, ${failures} failed, ${skipped} skipped.`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
