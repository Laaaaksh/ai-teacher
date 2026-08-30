import { getDb } from "../connection";
import type { DocumentOutlineRow } from "../types";
import type { DocumentOutline } from "../../rag/outline";

interface Row {
  document_id: string;
  outline_json: string;
  generated_at: string;
}

function fromRow(row: Row): DocumentOutlineRow {
  return { documentId: row.document_id, outline: JSON.parse(row.outline_json) as DocumentOutline, generatedAt: row.generated_at };
}

/** Upserts the outline for a document — regenerating (e.g. after a reparse) replaces the previous one rather than duplicating. */
export function saveDocumentOutline(outline: DocumentOutline): DocumentOutlineRow {
  const db = getDb();
  const generatedAt = outline.generatedAt;
  db.prepare(
    `INSERT INTO document_outlines (document_id, outline_json, generated_at)
     VALUES (@documentId, @outlineJson, @generatedAt)
     ON CONFLICT(document_id) DO UPDATE SET outline_json = excluded.outline_json, generated_at = excluded.generated_at`,
  ).run({ documentId: outline.documentId, outlineJson: JSON.stringify(outline), generatedAt });

  return getDocumentOutline(outline.documentId)!;
}

export function getDocumentOutline(documentId: string): DocumentOutlineRow | undefined {
  const row = getDb().prepare("SELECT * FROM document_outlines WHERE document_id = ?").get(documentId) as Row | undefined;
  return row ? fromRow(row) : undefined;
}
