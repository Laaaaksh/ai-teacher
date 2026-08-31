"use client";

import { useEffect, useState, type FormEvent } from "react";

/**
 * Standalone demo of the RAG/knowledge-grounding slice (lib/rag/*),
 * reachable before the lesson planner/teaching-loop UI lands: upload a
 * document, watch it index with visible progress, inspect its extracted
 * outline, and ask it questions — including ones it can't answer, to show
 * the anti-hallucination refusal, and in a different language than the
 * document, to show cross-language retrieval. A separate route rather than
 * a change to the home page, so it doesn't collide with the lesson-planner
 * slice's own UI work on app/page.tsx.
 */

const LANGUAGES = [
  { code: "en-IN", label: "English" },
  { code: "hi-IN", label: "Hindi" },
  { code: "hinglish", label: "Hinglish" },
  { code: "bn-IN", label: "Bengali" },
  { code: "ta-IN", label: "Tamil" },
  { code: "te-IN", label: "Telugu" },
  { code: "mr-IN", label: "Marathi" },
  { code: "kn-IN", label: "Kannada" },
  { code: "gu-IN", label: "Gujarati" },
  { code: "ml-IN", label: "Malayalam" },
  { code: "pa-IN", label: "Punjabi" },
] as const;

interface DocumentSummary {
  id: string;
  title: string;
  format: string;
  pageCount: number | null;
  language: string | null;
}

interface IndexProgress {
  total: number;
  embedded: number;
  done: boolean;
}

interface Citation {
  documentId: string;
  chunkId: string;
  page?: number;
  section?: string;
  excerpt: string;
}

interface AskResult {
  answer: string;
  grounded: boolean;
  citations: Citation[];
}

interface OutlineConcept {
  title: string;
  summary: string;
}
interface OutlineChapter {
  title: string;
  startPage?: number;
  endPage?: number;
  concepts: OutlineConcept[];
  definitions: { term: string; definition: string }[];
  examples: { title: string; description: string }[];
}

export default function RagDemo() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  const refreshDocuments = async () => {
    const res = await fetch("/api/documents");
    const data = await res.json();
    setDocuments(data.documents ?? []);
  };

  useEffect(() => {
    refreshDocuments();
  }, []);

  const selected = documents.find((d) => d.id === selectedId);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">RAG demo</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          Upload a document, watch it index, then ask it questions — including one it can&apos;t answer, and one in a
          different language than the document. This exercises lib/rag/* end to end.
        </p>
      </header>

      <UploadSection onUploaded={refreshDocuments} />

      <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-50">Documents</h2>
        {documents.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">No documents uploaded yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {documents.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(d.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selectedId === d.id
                      ? "border-neutral-900 bg-neutral-50 dark:border-neutral-100 dark:bg-neutral-800"
                      : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
                  }`}
                >
                  {d.title} <span className="text-neutral-400">({d.format.toUpperCase()}{d.pageCount ? `, ${d.pageCount}p` : ""}{d.language ? `, ${d.language}` : ""})</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected && <IndexProgressPanel key={selected.id} documentId={selected.id} />}
      {selected && <OutlinePanel key={`${selected.id}-outline`} documentId={selected.id} />}
      {selected && <AskPanel key={`${selected.id}-ask`} documentId={selected.id} />}
    </main>
  );
}

function UploadSection({ onUploaded }: { onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "uploaded" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleUpload() {
    if (!file) return;
    setStatus("uploading");
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/documents", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to upload document.");
      setStatus("uploaded");
      onUploaded();
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-50">Upload material</h2>
      <div className="mt-4 flex items-center gap-3">
        <input
          type="file"
          accept=".pdf,.docx,.pptx,.txt,.md,.markdown"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="input"
        />
        <button type="button" onClick={handleUpload} disabled={!file || status === "uploading"} className="btn-secondary shrink-0">
          {status === "uploading" ? "Uploading…" : "Upload"}
        </button>
      </div>
      {status === "error" && error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}

function IndexProgressPanel({ documentId }: { documentId: string }) {
  const [progress, setProgress] = useState<IndexProgress | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/documents/${documentId}/index`);
        if (cancelled) return;
        if (!res.ok) {
          timer = setTimeout(poll, 1500);
          return;
        }
        const data: IndexProgress = await res.json();
        if (cancelled) return;
        setProgress(data);
        if (!data.done) timer = setTimeout(poll, 1500);
      } catch {
        // A dev-server restart mid-index rejects the fetch; keep polling so the bar recovers rather than freezing.
        if (!cancelled) timer = setTimeout(poll, 1500);
      }
    }
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [documentId]);

  if (!progress) return null;
  const pct = progress.total === 0 ? 0 : Math.round((progress.embedded / progress.total) * 100);

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-50">Indexing</h2>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div className="h-full bg-neutral-900 transition-all dark:bg-neutral-100" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
        {progress.embedded} / {progress.total} chunks embedded{progress.done ? " — ready." : "…"}
      </p>
    </section>
  );
}

function OutlinePanel({ documentId }: { documentId: string }) {
  const [outline, setOutline] = useState<{ chapters: OutlineChapter[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/outline`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to build outline.");
      setOutline(data.outline);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-50">Chapter outline</h2>
        <button type="button" onClick={load} disabled={loading} className="btn-secondary">
          {loading ? "Extracting…" : outline ? "Refresh" : "Extract outline"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {outline && (
        <ol className="mt-4 flex flex-col gap-4">
          {outline.chapters.map((ch, i) => (
            <li key={i} className="border-l-2 border-neutral-200 pl-3 dark:border-neutral-800">
              <p className="font-medium text-neutral-900 dark:text-neutral-50">
                {ch.title}
                {ch.startPage && <span className="text-neutral-400"> (p.{ch.startPage}{ch.endPage && ch.endPage !== ch.startPage ? `–${ch.endPage}` : ""})</span>}
              </p>
              {ch.concepts.length > 0 && (
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  Concepts: {ch.concepts.map((c) => c.title).join(", ")}
                </p>
              )}
              {ch.examples.length > 0 && (
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  Worked examples: {ch.examples.map((e) => e.title).join(", ")}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AskPanel({ documentId }: { documentId: string }) {
  const [question, setQuestion] = useState("");
  const [language, setLanguage] = useState("en-IN");
  const [status, setStatus] = useState<"idle" | "asking" | "answered" | "error">("idle");
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAsk(e: FormEvent) {
    e.preventDefault();
    setStatus("asking");
    setError(null);
    try {
      const res = await fetch("/api/rag/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, question, languageCode: language }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to answer.");
      setResult(data);
      setStatus("answered");
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-50">Ask this document</h2>
      <form onSubmit={handleAsk} className="mt-4 flex flex-col gap-3">
        <textarea
          required
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className="input min-h-20"
          placeholder="Ask about a concept in this material — or something it doesn't cover, to see the honest refusal."
        />
        <div className="flex items-center gap-3">
          <select value={language} onChange={(e) => setLanguage(e.target.value)} className="input max-w-48">
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <button type="submit" disabled={status === "asking"} className="btn-primary shrink-0">
            {status === "asking" ? "Asking…" : "Ask"}
          </button>
        </div>
      </form>

      {status === "error" && error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {result && (
        <div className="mt-5 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <p className={`text-xs font-medium uppercase tracking-wide ${result.grounded ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
            {result.grounded ? "Grounded in the material" : "Not covered — declined rather than guessed"}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-200">{result.answer}</p>
          {result.citations.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Citations</p>
              {result.citations.map((c) => (
                <div key={c.chunkId} className="rounded bg-neutral-50 p-2 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                  <span className="font-medium">{c.section ?? (c.page ? `Page ${c.page}` : "Source")}:</span> {c.excerpt}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
