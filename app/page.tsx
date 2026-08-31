"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredLearnerProfileId, setStoredLearnerProfileId } from "@/lib/client/learner";

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

interface UploadedDocument {
  id: string;
  title: string;
  format: string;
  pageCount: number | null;
}

interface TeachingIntent {
  topic: string;
  level: (typeof LEVELS)[number];
  language: string;
  minutesAvailable: number;
  depth: (typeof DEPTHS)[number];
  style: string;
  wantsQuestions: boolean;
  wantsFinalAssessment: boolean;
  schedule?: { totalSessions: number; minutesPerSession: number };
  rawInstruction: string;
}

type Stage = "input" | "understanding" | "confirm" | "starting";

const EXAMPLE_INSTRUCTION =
  'e.g. "I am a beginner. Teach me Chapter 4 in 20 minutes. Explain it in Hindi using simple examples. Ask me questions during the lesson and test me at the end."';

export default function Home() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("input");
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [document, setDocument] = useState<UploadedDocument | null>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "uploaded" | "error">("idle");
  const [indexProgress, setIndexProgress] = useState<{ total: number; embedded: number; done: boolean } | null>(null);

  const [topic, setTopic] = useState("");
  const [instruction, setInstruction] = useState("");

  const [intent, setIntent] = useState<TeachingIntent | null>(null);
  const [learnerProfileId, setLearnerProfileId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLearnerProfileId(getStoredLearnerProfileId());
  }, []);

  // Poll indexing progress for whatever document was just uploaded — honest progress, not a blocking spinner.
  useEffect(() => {
    if (!document) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/documents/${document!.id}/index`);
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setIndexProgress(data);
        if (!data.done) timer = setTimeout(poll, 1200);
      } catch {
        if (!cancelled) timer = setTimeout(poll, 1500);
      }
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [document]);

  async function handleFileChosen(chosen: File | null) {
    setFile(chosen);
    setDocument(null);
    setIndexProgress(null);
    if (!chosen) return;

    setUploadStatus("uploading");
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", chosen);
      const res = await fetch("/api/documents", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to upload document.");
      setDocument(data.document);
      setUploadStatus("uploaded");
    } catch (err) {
      setError((err as Error).message);
      setUploadStatus("error");
    }
  }

  async function handleUnderstand() {
    if (!instruction.trim()) {
      setError("Tell the AI Teacher how you'd like to be taught first.");
      return;
    }
    if (!document && !topic.trim() && !/chapter|unit|topic/i.test(instruction)) {
      setError("Upload material or name a topic — the AI Teacher needs something to teach.");
      return;
    }

    setStage("understanding");
    setError(null);
    try {
      const res = await fetch("/api/teach/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, learnerProfileId: learnerProfileId ?? undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't understand that instruction.");

      const parsedIntent: TeachingIntent = data.intent;
      if (!parsedIntent.topic && topic.trim()) parsedIntent.topic = topic.trim();
      setIntent(parsedIntent);
      setStage("confirm");
    } catch (err) {
      setError((err as Error).message);
      setStage("input");
    }
  }

  async function handleStartLesson() {
    if (!intent) return;
    setStage("starting");
    setError(null);

    try {
      let profileId = learnerProfileId;
      const profileFields = {
        level: intent.level,
        language: intent.language,
        minutesAvailable: intent.minutesAvailable,
        depth: intent.depth,
        style: intent.style,
      };

      if (!profileId) {
        const res = await fetch("/api/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Learner", priorKnowledge: "", goal: "", ...profileFields }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to create learner profile.");
        profileId = data.profile.id;
        setStoredLearnerProfileId(profileId!);
        setLearnerProfileId(profileId);
      } else {
        await fetch(`/api/profile/${profileId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(profileFields),
        }).catch(() => {});
      }

      if (intent.schedule) {
        const res = await fetch("/api/teach/paths", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            learnerProfileId: profileId,
            topic: intent.topic || "General study plan",
            mode: "multi-day",
            totalSessions: intent.schedule.totalSessions,
            minutesPerSession: intent.schedule.minutesPerSession,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to build the learning path.");
        router.push(`/paths/${data.path.id}`);
        return;
      }

      const res = await fetch("/api/teach/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          learnerProfileId: profileId,
          topic: intent.topic || "General overview",
          sourceDocumentId: document?.id,
          sectionHint: document ? intent.topic : undefined,
          totalMinutes: intent.minutesAvailable,
          depth: intent.depth,
          language: intent.language,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to plan the lesson.");

      router.push(`/learn/${data.session.id}`);
    } catch (err) {
      setError((err as Error).message);
      setStage("confirm");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">AI Teacher</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          Upload what you want to learn, or name a topic — then tell it how you want to be taught, in your own words.
        </p>
      </header>

      {(stage === "input" || stage === "understanding") && (
        <section className="flex flex-col gap-6 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Upload material</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.pptx,.txt,.md,.markdown"
                onChange={(e) => handleFileChosen(e.target.files?.[0] ?? null)}
                className="input"
                disabled={uploadStatus === "uploading"}
              />
              {uploadStatus === "uploading" && <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">Parsing {file?.name}…</p>}
              {uploadStatus === "uploaded" && document && (
                <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
                  Parsed &ldquo;{document.title}&rdquo;{indexProgress && !indexProgress.done ? ` — indexing ${indexProgress.embedded}/${indexProgress.total}…` : indexProgress?.done ? " — indexed." : ""}
                </p>
              )}
              {uploadStatus === "error" && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
            </div>
            <div>
              <label className="label">Or name a topic</label>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="input"
                placeholder="e.g. Newton's Laws"
                disabled={!!document}
              />
            </div>
          </div>

          <div>
            <label className="label">How should the AI Teacher teach you?</label>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              className="input mt-1.5 min-h-32"
              placeholder={EXAMPLE_INSTRUCTION}
            />
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <button
            type="button"
            onClick={handleUnderstand}
            disabled={stage === "understanding"}
            className="btn-primary self-start"
          >
            {stage === "understanding" ? "Understanding…" : "Understand my request"}
          </button>
        </section>
      )}

      {stage === "confirm" && intent && (
        <ConfirmIntent
          intent={intent}
          onChange={setIntent}
          hasDocument={!!document}
          onBack={() => setStage("input")}
          onConfirm={handleStartLesson}
          error={error}
        />
      )}

      {stage === "starting" && (
        <section className="rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {intent?.schedule ? "Building your learning path…" : "Planning your lesson — this takes about a minute…"}
          </p>
        </section>
      )}
    </main>
  );
}

function ConfirmIntent({
  intent,
  onChange,
  hasDocument,
  onBack,
  onConfirm,
  error,
}: {
  intent: TeachingIntent;
  onChange: (i: TeachingIntent) => void;
  hasDocument: boolean;
  onBack: () => void;
  onConfirm: () => void;
  error: string | null;
}) {
  function set<K extends keyof TeachingIntent>(key: K, value: TeachingIntent[K]) {
    onChange({ ...intent, [key]: value });
  }

  return (
    <section className="flex flex-col gap-6 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div>
        <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-50">Here&apos;s what I understood</h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Correct anything before the lesson is built.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={hasDocument ? "Chapter / section" : "Topic"}>
          <input value={intent.topic} onChange={(e) => set("topic", e.target.value)} className="input" placeholder="e.g. Chapter 4" />
        </Field>
        <Field label="Level">
          <select value={intent.level} onChange={(e) => set("level", e.target.value as TeachingIntent["level"])} className="input">
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l[0].toUpperCase() + l.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Minutes">
          <input
            type="number"
            min={1}
            max={180}
            value={intent.minutesAvailable}
            onChange={(e) => set("minutesAvailable", Number(e.target.value))}
            className="input"
          />
        </Field>
        <Field label="Language">
          <select value={intent.language} onChange={(e) => set("language", e.target.value)} className="input">
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Depth">
          <select value={intent.depth} onChange={(e) => set("depth", e.target.value as TeachingIntent["depth"])} className="input">
            {DEPTHS.map((d) => (
              <option key={d} value={d}>
                {d[0].toUpperCase() + d.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Style">
          <input value={intent.style} onChange={(e) => set("style", e.target.value)} className="input" placeholder="e.g. simple examples" />
        </Field>
      </div>

      {intent.schedule && (
        <p className="rounded-lg bg-neutral-50 p-3 text-sm text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          This reads as a multi-day plan: {intent.schedule.totalSessions} sessions of {intent.schedule.minutesPerSession} minutes each. The AI
          Teacher will build a learning path instead of a single lesson.
        </p>
      )}

      <div className="flex flex-wrap gap-2 text-xs">
        <Badge>{intent.wantsQuestions ? "Will question you during the lesson" : "Light on checkpoints"}</Badge>
        <Badge>{intent.wantsFinalAssessment ? "Will test you at the end" : "Final check optional"}</Badge>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-3">
        <button type="button" onClick={onBack} className="btn-secondary">
          Back
        </button>
        <button type="button" onClick={onConfirm} className="btn-primary">
          Looks good — build my lesson
        </button>
      </div>
    </section>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-neutral-100 px-3 py-1 font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
      {children}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
