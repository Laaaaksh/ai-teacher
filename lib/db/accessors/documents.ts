import { randomUUID } from "node:crypto";
import { getDb } from "../connection";
import type { DocumentChunkRow, DocumentRow } from "../types";
import type { DocumentChunk, DocumentFormat, ParsedDocument } from "../../documents";

interface DocRow {
  id: string;
  title: string;
  format: string;
  page_count: number | null;
  language: string | null;
  uploaded_at: string;
}

interface ChunkRow {
  id: string;
  document_id: string;
  order: number;
  text: string;
  page: number | null;
  section: string | null;
  created_at: string;
}

function fromDocRow(row: DocRow): DocumentRow {
  return {
    id: row.id,
    title: row.title,
    format: row.format as DocumentFormat,
    pageCount: row.page_count,
    language: row.language,
    uploadedAt: row.uploaded_at,
  };
}

function fromChunkRow(row: ChunkRow): DocumentChunkRow {
  return {
    id: row.id,
    documentId: row.document_id,
    order: row.order,
    text: row.text,
    page: row.page,
    section: row.section,
    createdAt: row.created_at,
  };
}

/** Persists a parsed document plus its retrieval chunks in one transaction. */
export function saveDocument(
  parsed: ParsedDocument,
  chunks: DocumentChunk[],
  opts?: { language?: string },
): { document: DocumentRow; chunks: DocumentChunkRow[] } {
  const db = getDb();
  const documentId = randomUUID();
  const now = new Date().toISOString();

  const insertDocument = db.prepare(
    `INSERT INTO documents (id, title, format, page_count, language, uploaded_at)
     VALUES (@id, @title, @format, @pageCount, @language, @uploadedAt)`,
  );
  const insertChunk = db.prepare(
    `INSERT INTO document_chunks (id, document_id, "order", text, page, section, created_at)
     VALUES (@id, @documentId, @order, @text, @page, @section, @createdAt)`,
  );

  const run = db.transaction(() => {
    insertDocument.run({
      id: documentId,
      title: parsed.title,
      format: parsed.format,
      pageCount: parsed.pageCount ?? null,
      language: opts?.language ?? null,
      uploadedAt: now,
    });

    for (const chunk of chunks) {
      insertChunk.run({
        id: randomUUID(),
        documentId,
        order: chunk.order,
        text: chunk.text,
        page: chunk.page ?? null,
        section: chunk.section ?? null,
        createdAt: now,
      });
    }
  });
  run();

  return { document: getDocument(documentId)!, chunks: getDocumentChunks(documentId) };
}

export function getDocument(id: string): DocumentRow | undefined {
  const row = getDb().prepare("SELECT * FROM documents WHERE id = ?").get(id) as DocRow | undefined;
  return row ? fromDocRow(row) : undefined;
}

export function listDocuments(): DocumentRow[] {
  const rows = getDb().prepare("SELECT * FROM documents ORDER BY uploaded_at DESC").all() as DocRow[];
  return rows.map(fromDocRow);
}

export function getDocumentChunks(documentId: string): DocumentChunkRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM document_chunks WHERE document_id = ? ORDER BY "order" ASC`)
    .all(documentId) as ChunkRow[];
  return rows.map(fromChunkRow);
}
