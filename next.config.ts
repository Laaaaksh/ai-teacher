import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These ship native bindings (better-sqlite3), bundle badly under webpack's
  // RSC layer (pdf-parse/pdfjs-dist's exports interop), or resolve assets
  // through their own on-disk package layout at runtime (playwright's driver
  // and browser registry, mermaid's bundle, katex's CSS + fonts) — keep them
  // as real Node `require`s instead of trying to bundle them.
  serverExternalPackages: [
    "better-sqlite3",
    "pdf-parse",
    "pdfjs-dist",
    "mammoth",
    "@xenova/transformers",
    "onnxruntime-node",
    "sharp",
    "playwright",
    "mermaid",
    "katex",
  ],
};

export default nextConfig;
