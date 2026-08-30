export type DocumentErrorKind = "unsupported-format" | "empty-file" | "parse-failed";

export class DocumentParseError extends Error {
  readonly kind: DocumentErrorKind;
  readonly cause?: unknown;

  constructor(kind: DocumentErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = "DocumentParseError";
    this.kind = kind;
    this.cause = cause;
  }
}
