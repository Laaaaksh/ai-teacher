/** Typed errors for the Sarvam client — callers should branch on `kind`, never parse `.message`. */
export type SarvamErrorKind =
  | "config"
  | "network"
  | "timeout"
  | "http"
  | "truncated"
  | "empty-content"
  | "invalid-json"
  | "invalid-schema";

export class SarvamError extends Error {
  readonly kind: SarvamErrorKind;
  readonly status?: number;
  readonly cause?: unknown;

  constructor(kind: SarvamErrorKind, message: string, opts?: { status?: number; cause?: unknown }) {
    super(message);
    this.name = "SarvamError";
    this.kind = kind;
    this.status = opts?.status;
    this.cause = opts?.cause;
  }
}

export function isSarvamError(err: unknown): err is SarvamError {
  return err instanceof SarvamError;
}
