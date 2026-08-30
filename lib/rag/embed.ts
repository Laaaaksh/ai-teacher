import path from "node:path";
import {
  getChunksMissingEmbeddings,
  getDocument,
  getIndexingProgress,
  setChunkEmbedding,
  updateDocumentLanguage,
} from "../db/accessors/documents";
import { detectLanguage } from "./language";

/**
 * Local, key-free embeddings: @xenova/transformers running
 * all-MiniLM-L6-v2 (384-dim) as ONNX, entirely on-device — Sarvam has no
 * embeddings endpoint (see docs/ARCHITECTURE.md). The ONNX weights
 * (~23MB, quantized) download once from the Hugging Face hub and are
 * cached on disk under .cache/transformers/ (gitignored); every later
 * `getEmbedder()` call in this process reuses the already-loaded pipeline,
 * and every later request for the same chunk reuses the vector already
 * written to document_chunks.embedding — nothing is ever re-embedded.
 */

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIM = 384;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FeatureExtractionPipeline = (texts: string[], opts: { pooling: "mean"; normalize: boolean }) => Promise<any>;

let embedderPromise: Promise<FeatureExtractionPipeline> | undefined;

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const { pipeline, env } = await import("@xenova/transformers");
      env.cacheDir = path.join(process.cwd(), ".cache", "transformers");
      env.allowLocalModels = false;
      return (await pipeline("feature-extraction", MODEL_ID)) as unknown as FeatureExtractionPipeline;
    })();
  }
  return embedderPromise;
}

const DEFAULT_BATCH_SIZE = 16;

/** Embeds a batch of texts in one forward pass; mean-pooled and L2-normalized so cosine similarity reduces to a dot product. */
async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const embedder = await getEmbedder();
  const output = await embedder(texts, { pooling: "mean", normalize: true });
  const dim = output.dims[output.dims.length - 1] as number;
  const data = output.data as Float32Array;

  const vectors: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    vectors.push(data.slice(i * dim, (i + 1) * dim));
  }
  return vectors;
}

export interface EmbedProgress {
  completed: number;
  total: number;
}

/** Embeds `texts` in batches, reporting cumulative progress after each batch so a caller (e.g. the indexer below) can surface it. */
export async function embedTexts(texts: string[], opts?: { batchSize?: number; onProgress?: (p: EmbedProgress) => void }): Promise<Float32Array[]> {
  const batchSize = opts?.batchSize ?? DEFAULT_BATCH_SIZE;
  const vectors: Float32Array[] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    vectors.push(...(await embedBatch(batch)));
    opts?.onProgress?.({ completed: vectors.length, total: texts.length });
  }

  return vectors;
}

export async function embedOne(text: string): Promise<Float32Array> {
  const [vector] = await embedBatch([text]);
  return vector;
}

/** Serializes a Float32 vector to the BLOB shape stored in document_chunks.embedding. */
export function embeddingToBuffer(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

/** Deserializes document_chunks.embedding back into a Float32 vector. */
export function bufferToEmbedding(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

/** Both inputs are already L2-normalized (embedOne/embedBatch normalize), so cosine similarity is just the dot product. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export interface IndexingResult {
  total: number;
  embedded: number;
  /** How many chunks this call actually embedded (vs. were already done). */
  newlyEmbedded: number;
}

/**
 * Embeds every chunk of `documentId` that doesn't have a vector yet, in
 * batches, writing each batch back to SQLite immediately — so progress
 * (visible via getIndexingProgress, polled by the /api/documents/[id]/index
 * route) advances in real time and a crash mid-run loses at most one batch,
 * not the whole document. Idempotent: re-running only processes what's
 * still missing, which is also how a 300-page book stays within memory —
 * chunk text streams through in batches rather than all embeddings held at
 * once before writing.
 */
export async function indexDocument(documentId: string, opts?: { batchSize?: number; onProgress?: (p: EmbedProgress) => void }): Promise<IndexingResult> {
  const batchSize = opts?.batchSize ?? DEFAULT_BATCH_SIZE;
  const pending = getChunksMissingEmbeddings(documentId);
  const before = getIndexingProgress(documentId);

  const document = getDocument(documentId);
  if (document && !document.language && pending.length > 0) {
    // One-time language detection from a text sample, so cross-language
    // retrieval (lib/rag/language.ts) knows what to translate queries into.
    const sample = pending
      .slice(0, 5)
      .map((c) => c.text)
      .join(" ")
      .slice(0, 2000);
    updateDocumentLanguage(documentId, detectLanguage(sample));
  }

  let newlyEmbedded = 0;
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const vectors = await embedBatch(batch.map((c) => c.text));
    for (let j = 0; j < batch.length; j++) {
      setChunkEmbedding(batch[j].id, embeddingToBuffer(vectors[j]));
    }
    newlyEmbedded += batch.length;
    opts?.onProgress?.({ completed: before.embedded + newlyEmbedded, total: before.total });
  }

  const after = getIndexingProgress(documentId);
  return { total: after.total, embedded: after.embedded, newlyEmbedded };
}
