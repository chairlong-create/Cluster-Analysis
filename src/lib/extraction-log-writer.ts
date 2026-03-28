import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

type FailedExtractionAttemptInput = {
  db: Database.Database;
  stepRunId: string;
  dialogId: string;
  taskId: string;
  callType: string;
  model: string;
  errorMessage: string;
  createdAt: string;
};

export function recordFailedExtractionAttempt({
  db,
  stepRunId,
  dialogId,
  taskId,
  callType,
  model,
  errorMessage,
  createdAt,
}: FailedExtractionAttemptInput) {
  db.transaction(() => {
    db.prepare(`
      INSERT INTO step_run_items (
        id, step_run_id, dialog_id, raw_output_json, parsed_status, error_message, created_at
      ) VALUES (
        @id, @stepRunId, @dialogId, NULL, 'failed', @errorMessage, @createdAt
      )
    `).run({
      id: randomUUID(),
      stepRunId,
      dialogId,
      errorMessage,
      createdAt,
    });

    db.prepare(`
      INSERT INTO llm_call_logs (
        id, task_id, step_run_id, dialog_id, call_type, provider, model, prompt_text, response_text, status, latency_ms, created_at
      ) VALUES (
        @id, @taskId, @stepRunId, @dialogId, @callType, 'OpenAI-compatible', @model, '', @responseText, 'failed', 0, @createdAt
      )
    `).run({
      id: randomUUID(),
      taskId,
      stepRunId,
      dialogId,
      callType,
      model,
      responseText: errorMessage,
      createdAt,
    });
  })();
}
