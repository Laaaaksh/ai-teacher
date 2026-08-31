import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These ship native bindings (better-sqlite3) or bundle badly under
  // webpack's RSC layer (pdf-parse/pdfjs-dist's exports interop) — keep
  // them as real Node `require`s instead of trying to bundle them.
  serverExternalPackages: ["better-sqlite3", "pdf-parse", "pdfjs-dist", "mammoth"],
};

export default nextConfig;
