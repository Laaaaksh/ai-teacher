import type Database from "better-sqlite3";
import { migrations } from "./migrations";

/** Applies any migrations not yet recorded in schema_migrations, in order, each in its own transaction. */
export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TEXT NOT NULL
    );
  `);

  const applied = new Set(db.prepare("SELECT version FROM schema_migrations").all().map((row) => (row as { version: number }).version));

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;

    const run = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
    });
    run();
  }
}
