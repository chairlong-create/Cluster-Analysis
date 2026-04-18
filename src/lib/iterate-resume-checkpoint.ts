import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";

type IterateResumeCheckpointInput = {
  db: Database;
  taskId: string;
  batchId: string | null;
  stepType: "iterate_others_cluster" | "iterate_others_classify";
  sourceStartedAt: string;
  inputCount: number;
  errorMessage: string;
};

type ExistingRunRow = {
  id: string;
};

type LatestRoundRow = {
  latestRound: number;
};

export function recordFailedIterateResumeCheckpoint({
  db,
  taskId,
  batchId,
  stepType,
  sourceStartedAt,
  inputCount,
  errorMessage,
}: IterateResumeCheckpointInput) {
  const existing = (
    batchId
      ? db
          .prepare(`
            SELECT id
            FROM step_runs
            WHERE task_id = ?
              AND batch_id = ?
              AND step_type = ?
              AND started_at >= ?
            ORDER BY started_at DESC
            LIMIT 1
          `)
          .get(taskId, batchId, stepType, sourceStartedAt)
      : db
          .prepare(`
            SELECT id
            FROM step_runs
            WHERE task_id = ?
              AND batch_id IS NULL
              AND step_type = ?
              AND started_at >= ?
            ORDER BY started_at DESC
            LIMIT 1
          `)
          .get(taskId, stepType, sourceStartedAt)
  ) as ExistingRunRow | undefined;

  if (existing) {
    return { created: false, stepRunId: existing.id };
  }

  const latestRound = (
    batchId
      ? db
          .prepare(`
            SELECT COALESCE(MAX(round_no), 0) AS latestRound
            FROM step_runs
            WHERE task_id = ? AND batch_id = ? AND step_type = ?
          `)
          .get(taskId, batchId, stepType)
      : db
          .prepare(`
            SELECT COALESCE(MAX(round_no), 0) AS latestRound
            FROM step_runs
            WHERE task_id = ? AND batch_id IS NULL AND step_type = ?
          `)
          .get(taskId, stepType)
  ) as LatestRoundRow;

  const now = new Date().toISOString();
  const stepRunId = randomUUID();

  const insertRun = db.prepare(`
    INSERT INTO step_runs (
      id, task_id, batch_id, step_type, round_no, status, input_count, success_count, failed_count, started_at, finished_at, last_heartbeat_at
    ) VALUES (
      @id, @taskId, @batchId, @stepType, @roundNo, 'failed', @inputCount, 0, 1, @startedAt, @finishedAt, @lastHeartbeatAt
    )
  `);
  const insertItem = db.prepare(`
    INSERT INTO step_run_items (
      id, step_run_id, dialog_id, raw_output_json, parsed_status, error_message, created_at
    ) VALUES (
      @id, @stepRunId, NULL, NULL, 'failed', @errorMessage, @createdAt
    )
  `);

  db.transaction(() => {
    insertRun.run({
      id: stepRunId,
      taskId,
      batchId,
      stepType,
      roundNo: latestRound.latestRound + 1,
      inputCount,
      startedAt: now,
      finishedAt: now,
      lastHeartbeatAt: now,
    });
    insertItem.run({
      id: randomUUID(),
      stepRunId,
      errorMessage,
      createdAt: now,
    });
  })();

  return { created: true, stepRunId };
}
