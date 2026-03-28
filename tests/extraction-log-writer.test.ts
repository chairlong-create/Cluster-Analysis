import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { recordFailedExtractionAttempt } from "../src/lib/extraction-log-writer.ts";

test("recordFailedExtractionAttempt persists both item and llm log", () => {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE step_run_items (
      id TEXT PRIMARY KEY,
      step_run_id TEXT NOT NULL,
      dialog_id TEXT,
      raw_output_json TEXT,
      parsed_status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE llm_call_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      step_run_id TEXT,
      dialog_id TEXT,
      call_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      prompt_text TEXT,
      response_text TEXT,
      status TEXT NOT NULL,
      latency_ms INTEGER,
      created_at TEXT NOT NULL
    );
  `);

  recordFailedExtractionAttempt({
    db,
    stepRunId: "run-1",
    dialogId: "dialog-1",
    taskId: "task-1",
    callType: "extract",
    model: "deepseek-chat",
    errorMessage: "network boom",
    createdAt: "2026-03-28T18:20:00.000Z",
  });

  const itemRow = db
    .prepare(`SELECT parsed_status AS parsedStatus, error_message AS errorMessage FROM step_run_items`)
    .get() as { parsedStatus: string; errorMessage: string };
  const logRow = db
    .prepare(`SELECT status, response_text AS responseText, model FROM llm_call_logs`)
    .get() as { status: string; responseText: string; model: string };

  assert.deepEqual(itemRow, {
    parsedStatus: "failed",
    errorMessage: "network boom",
  });
  assert.deepEqual(logRow, {
    status: "failed",
    responseText: "network boom",
    model: "deepseek-chat",
  });
});
