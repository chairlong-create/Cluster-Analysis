import Database from "better-sqlite3";

const databaseFile = process.env.DATABASE_FILE || "/Users/chenlong/cluster-analysis-dev.db";

const globalForDb = globalThis as {
  sqlite?: Database.Database;
};

function initialize(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      llm_provider TEXT NOT NULL DEFAULT 'OpenAI-compatible',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      source_id_column TEXT NOT NULL,
      source_text_column TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      imported_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'imported',
      workflow_mode TEXT NOT NULL DEFAULT 'seed',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_batches_task_created_at ON batches(task_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS dialogs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      source_dialog_id TEXT NOT NULL,
      source_text TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE,
      UNIQUE(task_id, content_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_dialogs_batch_created_at ON dialogs(batch_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      name TEXT NOT NULL,
      definition TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_from_round INTEGER NOT NULL DEFAULT 0,
      is_other INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT NOT NULL DEFAULT 'human',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      UNIQUE(task_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_categories_task_is_other ON categories(task_id, is_other);

    CREATE TABLE IF NOT EXISTS dialog_analysis_results (
      id TEXT PRIMARY KEY,
      dialog_id TEXT NOT NULL UNIQUE,
      task_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      category_id TEXT,
      category_name_snapshot TEXT,
      buy_block_reason TEXT,
      evidence_quote TEXT,
      evidence_explanation TEXT,
      source_step_run_id TEXT,
      result_status TEXT NOT NULL DEFAULT 'pending',
      review_status TEXT NOT NULL DEFAULT 'unreviewed',
      updated_at TEXT NOT NULL,
      FOREIGN KEY (dialog_id) REFERENCES dialogs(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_results_task_batch ON dialog_analysis_results(task_id, batch_id);
    CREATE INDEX IF NOT EXISTS idx_results_category_id ON dialog_analysis_results(category_id);

    CREATE TABLE IF NOT EXISTS step_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      batch_id TEXT,
      step_type TEXT NOT NULL,
      round_no INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      input_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_step_runs_task_step_started_at ON step_runs(task_id, step_type, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_step_runs_status_step_type ON step_runs(status, step_type);

    CREATE TABLE IF NOT EXISTS step_run_items (
      id TEXT PRIMARY KEY,
      step_run_id TEXT NOT NULL,
      dialog_id TEXT,
      raw_output_json TEXT,
      parsed_status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (step_run_id) REFERENCES step_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (dialog_id) REFERENCES dialogs(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_step_run_items_run_created_at ON step_run_items(step_run_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS llm_call_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      step_run_id TEXT,
      dialog_id TEXT,
      call_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      prompt_text TEXT,
      response_text TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      latency_ms INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (step_run_id) REFERENCES step_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (dialog_id) REFERENCES dialogs(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_llm_call_logs_run_created_at ON llm_call_logs(step_run_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_llm_call_logs_run_status ON llm_call_logs(step_run_id, status);

    CREATE TABLE IF NOT EXISTS category_suggestions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      batch_id TEXT,
      source_step_run_id TEXT NOT NULL,
      name TEXT NOT NULL,
      definition TEXT NOT NULL,
      example_reasons_json TEXT,
      status TEXT NOT NULL DEFAULT 'suggested',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE,
      FOREIGN KEY (source_step_run_id) REFERENCES step_runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_category_suggestions_task_batch ON category_suggestions(task_id, batch_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS category_merge_suggestion_items (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      merge_run_id TEXT NOT NULL,
      suggested_name TEXT NOT NULL,
      suggested_definition TEXT NOT NULL,
      source_category_ids_json TEXT NOT NULL,
      source_category_names_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'suggested',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (merge_run_id) REFERENCES step_runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_category_merge_items_task_status ON category_merge_suggestion_items(task_id, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS category_merge_mappings (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      merge_run_id TEXT NOT NULL,
      from_category_id TEXT NOT NULL,
      to_category_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (merge_run_id) REFERENCES step_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (from_category_id) REFERENCES categories(id) ON DELETE CASCADE,
      FOREIGN KEY (to_category_id) REFERENCES categories(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_category_merge_mappings_task_run ON category_merge_mappings(task_id, merge_run_id);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_results_task_updated_at
      ON dialog_analysis_results(task_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_results_task_category_snapshot_batch
      ON dialog_analysis_results(task_id, category_name_snapshot, batch_id);
  `);

  db.prepare(`
    UPDATE tasks
    SET llm_provider = 'OpenAI-compatible'
    WHERE llm_provider = 'MiniMax'
  `).run();

  const taskColumns = db
    .prepare(`PRAGMA table_info(tasks)`)
    .all() as Array<{ name: string }>;
  const batchColumns = db
    .prepare(`PRAGMA table_info(batches)`)
    .all() as Array<{ name: string }>;

  const hasAnalysisGoal = taskColumns.some((column) => column.name === "analysis_goal");
  const hasAnalysisFocusLabel = taskColumns.some((column) => column.name === "analysis_focus_label");
  const hasWorkflowMode = batchColumns.some((column) => column.name === "workflow_mode");
  const stepRunColumns = db
    .prepare(`PRAGMA table_info(step_runs)`)
    .all() as Array<{ name: string }>;
  const hasLastHeartbeatAt = stepRunColumns.some((column) => column.name === "last_heartbeat_at");

  if (!hasAnalysisGoal) {
    db.exec(`
      ALTER TABLE tasks
      ADD COLUMN analysis_goal TEXT NOT NULL DEFAULT '分析客户不购买原因'
    `);
  }

  if (!hasAnalysisFocusLabel) {
    db.exec(`
      ALTER TABLE tasks
      ADD COLUMN analysis_focus_label TEXT NOT NULL DEFAULT '原因'
    `);
  }

  if (!hasWorkflowMode) {
    db.exec(`
      ALTER TABLE batches
      ADD COLUMN workflow_mode TEXT NOT NULL DEFAULT 'seed'
    `);
  }

  if (!hasLastHeartbeatAt) {
    db.exec(`
      ALTER TABLE step_runs
      ADD COLUMN last_heartbeat_at TEXT
    `);
  }
}

export const db =
  globalForDb.sqlite ??
  (() => {
    const instance = new Database(databaseFile);
    initialize(instance);
    globalForDb.sqlite = instance;
    return instance;
  })();
