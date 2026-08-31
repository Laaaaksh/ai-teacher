/** Escaping helpers shared by compose.ts and every renderer under visuals/ — one copy so an escaping fix lands everywhere at once. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * `JSON.stringify` escapes quotes but not `</`, so a narration line containing
 * a literal `</script>` (a lesson about HTML, say) would close the inline
 * script element early and silently kill the frame driver — captured frames
 * would still be produced, just with no captions, reveal or avatar motion.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/**
 * `VisualSpec.content` is LLM-authored JSON, so wrong-shaped values are an
 * expected input, not a corner case. Narrows a value to something renderable
 * as text; returns null for shapes that aren't (objects, arrays, null).
 */
export function asDisplayText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return null;
}

/** A finite number, or undefined for anything else (NaN/Infinity/strings/objects). */
export function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
