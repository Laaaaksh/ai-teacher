import Link from "next/link";
import type { AssessmentReport } from "./types";

/** The learning report: score, what stuck, what didn't, and what to do next — the moment the spec's teaching loop resolves into something a student would actually want to read. */
export function Report({ report }: { report: AssessmentReport }) {
  const scoreColor = report.score >= 80 ? "text-emerald-600 dark:text-emerald-400" : report.score >= 50 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";

  return (
    <div className="flex flex-col gap-6">
      <header className="rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{report.topic}</p>
        <p className={`mt-2 text-5xl font-semibold ${scoreColor}`}>{Math.round(report.score)}%</p>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Final score</p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ReportSection title="Concepts you understood" tone="good" items={report.conceptsUnderstood} />
        <ReportSection title="Weak areas" tone="warn" items={report.weakAreas} />
      </div>

      {report.misconceptionsHeld.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950">
          <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200">Misconceptions still held</h3>
          <ul className="mt-3 flex flex-col gap-2">
            {report.misconceptionsHeld.map((m) => (
              <li key={m.id} className="text-sm">
                <span className="font-medium text-amber-900 dark:text-amber-100">{m.label}</span>
                <span className="text-amber-800 dark:text-amber-200"> — {m.description}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-50">Recommended revision</h3>
        <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">{report.recommendedRevision}</p>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-50">Suggested next topic</h3>
        <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">{report.suggestedNextTopic}</p>
      </section>

      <div className="flex gap-3">
        <Link href="/" className="btn-primary">
          Start another lesson
        </Link>
        <Link href="/progress" className="btn-secondary">
          View progress
        </Link>
      </div>
    </div>
  );
}

function ReportSection({ title, tone, items }: { title: string; tone: "good" | "warn"; items: string[] }) {
  const border = tone === "good" ? "border-emerald-200 dark:border-emerald-900" : "border-amber-200 dark:border-amber-900";
  const bg = tone === "good" ? "bg-emerald-50 dark:bg-emerald-950" : "bg-amber-50 dark:bg-amber-950";
  const text = tone === "good" ? "text-emerald-900 dark:text-emerald-100" : "text-amber-900 dark:text-amber-100";

  return (
    <section className={`rounded-xl border p-5 ${border} ${bg}`}>
      <h3 className={`text-sm font-medium ${text}`}>{title}</h3>
      {items.length === 0 ? (
        <p className={`mt-2 text-sm opacity-70 ${text}`}>None recorded.</p>
      ) : (
        <ul className={`mt-2 flex flex-col gap-1 text-sm ${text}`}>
          {items.map((item, i) => (
            <li key={i}>• {item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
