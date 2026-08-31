/**
 * The submission documentation's whole value to a jury is that nothing in it
 * is overstated — one invented claim discredits the rest. These tests guard
 * the parts of that promise a machine can check: the Section 20 file set is
 * complete and in order, every cross-link resolves, the referenced assets
 * exist, and doc 12's decision table is the real `SUBJECT_VISUAL_RULES`
 * rather than a prose paraphrase that can silently drift from the code.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const SUBMISSION = path.join(ROOT, "docs/submission");

/** Section 20's list, in the order it gives them. */
const SECTION_20 = [
  "01-problem-statement",
  "02-solution-overview",
  "03-key-features",
  "04-system-architecture",
  "05-ai-ml-models",
  "06-rag-implementation",
  "07-prompt-agent-architecture",
  "08-personalisation-approach",
  "09-assessment-methodology",
  "10-multilingual-implementation",
  "11-voice-implementation",
  "12-avatar-video-generation",
  "13-apis-third-party-services",
  "14-setup-instructions",
  "15-deployment-instructions",
  "16-known-limitations",
];

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** GitHub's heading-anchor slug, close enough for the anchors this repo uses. */
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(full);
    return entry.name.endsWith(".md") ? [full] : [];
  });
}

describe("submission documentation", () => {
  it("covers every Section 20 topic, in order, one file each", () => {
    const present = readdirSync(SUBMISSION)
      .filter((f) => /^\d\d-.*\.md$/.test(f))
      .sort()
      .map((f) => f.replace(/\.md$/, ""));

    expect(present).toEqual(SECTION_20);
  });

  it("indexes all sixteen from docs/submission/README.md, and the top-level README links into it", () => {
    const index = read("docs/submission/README.md");
    for (const doc of SECTION_20) {
      expect(index, `${doc} missing from the submission index`).toContain(`${doc}.md`);
    }
    expect(read("README.md")).toContain("docs/submission/");
  });

  it("resolves every local link and heading anchor across docs/ and the top-level README", () => {
    const files = [...markdownFiles(path.join(ROOT, "docs")), path.join(ROOT, "README.md")];
    const broken: string[] = [];

    for (const file of files) {
      const body = readFileSync(file, "utf8");
      for (const [, , target] of body.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)) {
        if (/^(https?:|mailto:)/.test(target)) continue;
        const [rel, anchor] = target.split("#");
        const resolved = rel ? path.resolve(path.dirname(file), rel) : file;
        const where = `${path.relative(ROOT, file)} -> ${target}`;

        if (!existsSync(resolved)) {
          broken.push(where);
          continue;
        }
        if (!anchor) continue;
        const anchors = readFileSync(resolved, "utf8")
          .split("\n")
          .filter((line) => /^#{1,6}\s/.test(line))
          .map((line) => slug(line.replace(/^#{1,6}\s+/, "")));
        if (!anchors.includes(anchor)) broken.push(where);
      }
    }

    expect(broken).toEqual([]);
  });

  it("ships the evidence images the README and known-limitations doc embed", () => {
    expect(read("README.md")).toContain("docs/submission/assets/lesson-demo.gif");
    expect(read("docs/submission/16-known-limitations.md")).toContain(
      "assets/screenshot-visual-fallback-example.png",
    );
    expect(existsSync(path.join(SUBMISSION, "assets/lesson-demo.gif"))).toBe(true);
    expect(existsSync(path.join(SUBMISSION, "assets/screenshot-visual-fallback-example.png"))).toBe(true);
  });

  it("quotes SUBJECT_VISUAL_RULES verbatim in doc 12 rather than paraphrasing it", () => {
    const table = read("docs/submission/12-avatar-video-generation.md")
      .split("### The decision table")[1]
      .split("A beat not listed")[0];
    const code = read("lib/teach/script.ts");

    // Every rationale the code can emit is quoted in the table…
    const fromCode = [...code.matchAll(/rationale:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(fromCode.length).toBeGreaterThan(0);
    for (const rationale of fromCode) {
      expect(table, `rationale missing from doc 12's table: ${rationale}`).toContain(rationale);
    }

    // …and nothing in the table was invented for the document.
    for (const [, quoted] of table.matchAll(/\|\s*"([^"]+)"\s*\|/g)) {
      expect(code, `doc 12 quotes a rationale absent from script.ts: ${quoted}`).toContain(quoted);
    }
  });
});
