"use client";

import { useState, type FormEvent } from "react";

const LEVELS = ["beginner", "intermediate", "advanced"] as const;
const DEPTHS = ["overview", "standard", "deep"] as const;
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

interface SavedProfile {
  id: string;
  name: string;
}

interface UploadedDocument {
  id: string;
  title: string;
  format: string;
  pageCount: number | null;
}

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">AI Teacher</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          Tell us about the learner, then upload material or name a topic. The lesson planner and video
          player build on what you set up here.
        </p>
      </header>

      <LearnerProfileForm />
      <MaterialSection />
    </main>
  );
}

function LearnerProfileForm() {
  const [name, setName] = useState("");
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("beginner");
  const [priorKnowledge, setPriorKnowledge] = useState("");
  const [goal, setGoal] = useState("");
  const [style, setStyle] = useState("");
  const [language, setLanguage] = useState("en-IN");
  const [minutesAvailable, setMinutesAvailable] = useState(20);
  const [depth, setDepth] = useState<(typeof DEPTHS)[number]>("standard");

  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedProfile | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError(null);

    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, level, priorKnowledge, goal, style, language, minutesAvailable, depth }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save profile.");

      setSaved({ id: data.profile.id, name: data.profile.name });
      setStatus("saved");
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-50">Learner profile</h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        This is what the AI Teacher uses to pitch the lesson at the right level and pace.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
            placeholder="e.g. Aditi"
          />
        </Field>

        <Field label="Level">
          <select value={level} onChange={(e) => setLevel(e.target.value as typeof level)} className="input">
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l[0].toUpperCase() + l.slice(1)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Goal" className="sm:col-span-2">
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="input"
            placeholder="e.g. pass a Class 10 board exam"
          />
        </Field>

        <Field label="Prior knowledge" className="sm:col-span-2">
          <textarea
            value={priorKnowledge}
            onChange={(e) => setPriorKnowledge(e.target.value)}
            className="input min-h-20"
            placeholder="What does the learner already know about this?"
          />
        </Field>

        <Field label="Preferred style">
          <input
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            className="input"
            placeholder="e.g. analogy-heavy, example-driven"
          />
        </Field>

        <Field label="Teaching language">
          <select value={language} onChange={(e) => setLanguage(e.target.value)} className="input">
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Minutes available">
          <input
            type="number"
            min={1}
            max={10080}
            value={minutesAvailable}
            onChange={(e) => setMinutesAvailable(Number(e.target.value))}
            className="input"
          />
        </Field>

        <Field label="Depth">
          <select value={depth} onChange={(e) => setDepth(e.target.value as typeof depth)} className="input">
            {DEPTHS.map((d) => (
              <option key={d} value={d}>
                {d[0].toUpperCase() + d.slice(1)}
              </option>
            ))}
          </select>
        </Field>

        <div className="sm:col-span-2 flex items-center gap-3 pt-2">
          <button type="submit" disabled={status === "saving"} className="btn-primary">
            {status === "saving" ? "Saving…" : "Save profile"}
          </button>
          {status === "saved" && saved && (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved as {saved.name}.</span>
          )}
          {status === "error" && error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
        </div>
      </form>
    </section>
  );
}

function MaterialSection() {
  const [topic, setTopic] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "uploaded" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<UploadedDocument | null>(null);
  const [chunkCount, setChunkCount] = useState(0);

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

      setUploaded(data.document);
      setChunkCount(data.chunkCount);
      setStatus("uploaded");
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-50">Material or topic</h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Upload a book, PDF, DOCX, PPTX, or notes — or just name a topic to teach from scratch.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <label className="label">Upload material</label>
          <input
            type="file"
            accept=".pdf,.docx,.pptx,.txt,.md,.markdown"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="input"
          />
          <button
            type="button"
            onClick={handleUpload}
            disabled={!file || status === "uploading"}
            className="btn-secondary mt-3"
          >
            {status === "uploading" ? "Uploading…" : "Upload"}
          </button>

          {status === "uploaded" && uploaded && (
            <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">
              Parsed &ldquo;{uploaded.title}&rdquo; ({uploaded.format.toUpperCase()}
              {uploaded.pageCount ? `, ${uploaded.pageCount} pages` : ""}) into {chunkCount} citable chunks.
            </p>
          )}
          {status === "error" && error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div>
          <label className="label">Or name a topic</label>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="input"
            placeholder="e.g. Newton's Laws for a Class 8 student"
          />
          <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
            The lesson planner picks this up in the next build. Set your profile and material above so it&apos;s
            ready to go.
          </p>
        </div>
      </div>
    </section>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
