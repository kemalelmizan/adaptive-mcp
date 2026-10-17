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
    up: (db) =>
      db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_timestamp ON execution_nodes(timestamp)`),
  },
  {
    version: 3,
    name: "add_metric_cells",
    up: (db) =>
      db.exec(`
CREATE TABLE IF NOT EXISTS metric_cells (
  tool_name TEXT NOT NULL,
  server_name TEXT NOT NULL DEFAULT '',
  window TEXT NOT NULL DEFAULT 'all',
  dims_key TEXT NOT NULL,
  dims TEXT NOT NULL,
  invocations INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  error_codes TEXT NOT NULL DEFAULT '{}',
  duration_sum REAL NOT NULL DEFAULT 0,
  duration_count INTEGER NOT NULL DEFAULT 0,
  duration_hist TEXT NOT NULL DEFAULT '[]',
  token_in_sum REAL NOT NULL DEFAULT 0,
  token_out_sum REAL NOT NULL DEFAULT 0,
  token_count INTEGER NOT NULL DEFAULT 0,
  cost_sum REAL NOT NULL DEFAULT 0,
  ewma_failure_rate REAL,
  ewma_duration_ms REAL,
  first_seen TEXT,
  last_seen TEXT,
  exemplars TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (tool_name, server_name, window, dims_key)
);
CREATE INDEX IF NOT EXISTS idx_metric_cells_tool ON metric_cells(tool_name, server_name);
`),
  },
  {
    version: 4,
    name: "add_metric_cells_attempts",
    up: (db) => db.exec(`ALTER TABLE metric_cells ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`),
  },
  {
    version: 5,
    name: "add_suspensions",
    up: (db) =>
      db.exec(`
CREATE TABLE IF NOT EXISTS suspensions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  question TEXT NOT NULL,
  response_schema TEXT,
  resume_state TEXT,
  status TEXT NOT NULL,
  answer TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_suspensions_session ON suspensions(session_id, status);
CREATE INDEX IF NOT EXISTS idx_suspensions_status ON suspensions(status);
`),
  },
  {
    version: 6,
    name: "add_tasks_and_steps",
    up: (db) =>
      db.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  assignee TEXT,
  parent_id TEXT,
  result TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id, status);

-- Dependencies are their own table rather than a JSON column so that
-- "ready to start" is one SQL question that stays correct as statuses move.
-- The ord column preserves the order the host wrote them in.
CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL,
  depends_on TEXT NOT NULL,
  ord INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, depends_on)
);

CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON task_dependencies(depends_on);

-- Action and plan steps share one table under a kind discriminator: they are
-- read back together (with tasks) as a single ordered history, which is the
-- point of typed steps. Kind-specific fields are nullable by design.
CREATE TABLE IF NOT EXISTS steps (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT,
  tool_name TEXT,
  error TEXT,
  duration_ms REAL,
  correlation_id TEXT,
  plan TEXT,
  reasoning TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_steps_session ON steps(session_id, kind, created_at);
`),
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
    (db.prepare(`SELECT version FROM schema_migrations`).all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  const insert = db.prepare(
    `INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`,
  );
  for (const migration of ordered) {
    if (applied.has(migration.version)) continue;
    migration.up(db);
    insert.run(migration.version, migration.name, new Date().toISOString());
  }
}
