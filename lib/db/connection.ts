import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { runMigrations } from "./migrate";

let instance: Database.Database | undefined;

/**
 * Path to the SQLite file. Tests set DB_PATH=":memory:"; production defaults
 * to data/ai-teacher.sqlite, created on first run.
 */
function resolveDbPath(): string {
  const configured = process.env.DB_PATH;
  if (configured) return configured;
  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "ai-teacher.sqlite");
}

/** Returns the process-wide database handle, running migrations on first access ("a migration on boot"). */
export function getDb(): Database.Database {
  if (instance) return instance;

  const dbPath = resolveDbPath();
  instance = new Database(dbPath);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");
  runMigrations(instance);
  return instance;
}

/**
 * Runs `work` inside a single database transaction, rolling back everything
 * it wrote if it throws. Accessors that open their own transaction nest
 * safely inside this one (better-sqlite3 turns those into savepoints), so a
 * multi-accessor write like creating a whole taught lesson is all-or-nothing
 * rather than leaving a half-written session behind.
 */
export function runInTransaction<T>(work: () => T): T {
  return getDb().transaction(work)();
}

/** Test-only: close and drop the cached handle so the next getDb() call reopens fresh. */
export function resetDbForTests(): void {
  instance?.close();
  instance = undefined;
}
