import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
}

const INIT_SCHEMA = `
CREATE TABLE IF NOT EXISTS tools (
  tool_name TEXT NOT NULL,
  server_name TEXT NOT NULL DEFAULT '',
  annotation TEXT NOT NULL,
  insights TEXT NOT NULL DEFAULT '[]',
  recommendations TEXT NOT NULL DEFAULT '[]',
  stats TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tool_name, server_name)
);

CREATE TABLE IF NOT EXISTS execution_nodes (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  server_name TEXT,
  session_id TEXT NOT NULL,
  workflow_id TEXT,
  parent_id TEXT,
  children_ids TEXT NOT NULL DEFAULT '[]',
  timestamp TEXT NOT NULL,
  duration_ms INTEGER,
  status TEXT NOT NULL,
  input TEXT,
  output TEXT,
  error TEXT,
  model TEXT,
  cost TEXT,
  metadata TEXT,
  FOREIGN KEY (parent_id) REFERENCES execution_nodes(id)
);

CREATE INDEX IF NOT EXISTS idx_nodes_session ON execution_nodes(session_id);
CREATE INDEX IF NOT EXISTS idx_nodes_workflow ON execution_nodes(workflow_id);
CREATE INDEX IF NOT EXISTS idx_nodes_tool ON execution_nodes(tool_name);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON execution_nodes(parent_id);
`;

/**
 * Ordered, idempotent schema history. Each migration's `up` must be safe to
 * run against a fresh `:memory:` database (migration 1 recreates the whole
 * schema `IF NOT EXISTS`) as well as against a pre-existing file database
 * that already has these objects from before this framework existed.
 */
export const MIGRATIONS: Migration[] = [
  { version: 1, name: "init_schema", up: (db) => db.exec(INIT_SCHEMA) },
  {
    version: 2,
    name: "add_nodes_timestamp_index",
    up: (db) => db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_timestamp ON execution_nodes(timestamp)`),
  },
];

/** Applies every migration in `migrations` that hasn't already been recorded, in version order. */
export function runMigrations(db: DatabaseSync, migrations: Migration[] = MIGRATIONS): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`,
  );
  const applied = new Set(
    (db.prepare(`SELECT version FROM schema_migrations`).all() as { version: number }[]).map((r) => r.version),
  );
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  const insert = db.prepare(`INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`);
  for (const migration of ordered) {
    if (applied.has(migration.version)) continue;
    migration.up(db);
    insert.run(migration.version, migration.name, new Date().toISOString());
  }
}
