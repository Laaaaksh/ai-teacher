/** Typed errors for the Sarvam client — callers should branch on `kind`, never parse `.message`. */
export type SarvamErrorKind =
  | "config"
  | "network"
  | "timeout"
  | "http"
  | "truncated"
  | "empty-content"
  | "invalid-json"
  | "invalid-schema"
  /** A successful HTTP response whose BODY wasn't JSON — a transport/gateway
   * failure, distinct from `invalid-json` (the model's own output wasn't
   * parseable). Only the latter is worth re-asking; re-POSTing this one bills
   * a request Sarvam already processed. */
  | "invalid-response-body";

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
