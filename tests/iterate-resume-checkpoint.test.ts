import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { recordFailedIterateResumeCheckpoint } from "../src/lib/iterate-resume-checkpoint.ts";

test("recordFailedIterateResumeCheckpoint records a failed bridge run when none exists", () => {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE step_runs (
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
      last_heartbeat_at TEXT
    );

    CREATE TABLE step_run_items (
      id TEXT PRIMARY KEY,
      step_run_id TEXT NOT NULL,
      dialog_id TEXT,
      raw_output_json TEXT,
      parsed_status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      created_at TEXT NOT NULL
    );
  `);

  const sourceStartedAt = "2026-04-18T15:28:10.204Z";

  const result = recordFailedIterateResumeCheckpoint({
    db,
    taskId: "task-1",
    batchId: null,
    stepType: "iterate_others_cluster",
    sourceStartedAt,
    inputCount: 13,
    errorMessage: "聚类结果解析失败",
  });

  assert.equal(result.created, true);

  const run = db
    .prepare(`
      SELECT step_type AS stepType, status, input_count AS inputCount, success_count AS successCount, failed_count AS failedCount
      FROM step_runs
    `)
    .get() as { stepType: string; status: string; inputCount: number; successCount: number; failedCount: number };
  const item = db
    .prepare(`SELECT step_run_id AS stepRunId, parsed_status AS parsedStatus, error_message AS errorMessage FROM step_run_items`)
    .get() as { stepRunId: string; parsedStatus: string; errorMessage: string };

  assert.deepEqual(run, {
    stepType: "iterate_others_cluster",
    status: "failed",
    inputCount: 13,
    successCount: 0,
    failedCount: 1,
  });
  assert.equal(item.stepRunId, result.stepRunId);
  assert.equal(item.parsedStatus, "failed");
  assert.equal(item.errorMessage, "聚类结果解析失败");
});

test("recordFailedIterateResumeCheckpoint does not duplicate an existing later run", () => {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE step_runs (
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
      last_heartbeat_at TEXT
    );

    CREATE TABLE step_run_items (
      id TEXT PRIMARY KEY,
      step_run_id TEXT NOT NULL,
      dialog_id TEXT,
      raw_output_json TEXT,
      parsed_status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      created_at TEXT NOT NULL
    );
  `);

  db.prepare(`
    INSERT INTO step_runs (
      id, task_id, batch_id, step_type, round_no, status, input_count, success_count, failed_count, started_at, finished_at
    ) VALUES (
      'existing-run', 'task-1', NULL, 'iterate_others_cluster', 1, 'failed', 13, 0, 1, '2026-04-18T15:29:00.000Z', '2026-04-18T15:29:00.000Z'
    )
  `).run();

  const result = recordFailedIterateResumeCheckpoint({
    db,
    taskId: "task-1",
    batchId: null,
    stepType: "iterate_others_cluster",
    sourceStartedAt: "2026-04-18T15:28:10.204Z",
    inputCount: 13,
    errorMessage: "聚类结果解析失败",
  });

  assert.equal(result.created, false);
  assert.equal(result.stepRunId, "existing-run");

  const runCount = (db.prepare(`SELECT COUNT(*) AS count FROM step_runs`).get() as { count: number }).count;
  const itemCount = (db.prepare(`SELECT COUNT(*) AS count FROM step_run_items`).get() as { count: number }).count;

  assert.equal(runCount, 1);
  assert.equal(itemCount, 0);
});
