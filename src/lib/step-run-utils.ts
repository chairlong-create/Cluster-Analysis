import { db } from "@/lib/db";

type RunningScope = {
  taskId: string;
  batchId: string | null;
  stepType: string;
};

export function failRunningStepRuns({ taskId, batchId, stepType }: RunningScope) {
  const finishedAt = new Date().toISOString();

  if (batchId) {
    return db
      .prepare(`
        UPDATE step_runs
        SET
          status = 'failed',
          failed_count = CASE
            WHEN failed_count = 0 AND success_count = 0 THEN 1
            ELSE failed_count
          END,
          finished_at = @finishedAt
        WHERE task_id = @taskId
          AND batch_id = @batchId
          AND step_type = @stepType
          AND status = 'running'
      `)
      .run({
        taskId,
        batchId,
        stepType,
        finishedAt,
      });
  }

  return db
    .prepare(`
      UPDATE step_runs
      SET
        status = 'failed',
        failed_count = CASE
          WHEN failed_count = 0 AND success_count = 0 THEN 1
          ELSE failed_count
        END,
        finished_at = @finishedAt
      WHERE task_id = @taskId
        AND batch_id IS NULL
        AND step_type = @stepType
        AND status = 'running'
    `)
    .run({
      taskId,
      stepType,
      finishedAt,
    });
}

export function failStepRun(stepRunId: string) {
  const finishedAt = new Date().toISOString();

  return db
    .prepare(`
      UPDATE step_runs
      SET
        status = 'failed',
        failed_count = CASE
          WHEN failed_count = 0 AND success_count = 0 THEN 1
          ELSE failed_count
        END,
        finished_at = @finishedAt
      WHERE id = @id
        AND status = 'running'
    `)
    .run({
      id: stepRunId,
      finishedAt,
    });
}

type ReconcileCandidate = {
  id: string;
  taskId: string;
  batchId: string | null;
  stepType: string;
  inputCount: number;
  successCount: number;
  failedCount: number;
  startedAt: string;
  lastActivityAt: string | null;
  lastHeartbeatAt: string | null;
};

function mapRecoveredBatchStatus(stepType: string, successCount: number, failedCount: number) {
  if (stepType === "extract_reasons" || stepType === "iterate_others_extract") {
    if (successCount > 0 && failedCount === 0) {
      return "reasons_extracted";
    }
    if (successCount > 0 && failedCount > 0) {
      return "extract_partial";
    }
    return "extract_failed";
  }

  if (stepType === "classify" || stepType === "classify_retry" || stepType === "iterate_others_classify") {
    if (successCount === 0 && failedCount > 0) {
      return "classify_failed";
    }
    if (failedCount > 0) {
      return "classify_partial";
    }
    return "categorized";
  }

  return null;
}

export function reconcileStalledStepRuns(staleAfterMs = 15000) {
  const cutoff = new Date(Date.now() - staleAfterMs).toISOString();

  const candidates = db
    .prepare(`
      SELECT
        sr.id,
        sr.task_id AS taskId,
        sr.batch_id AS batchId,
        sr.step_type AS stepType,
        sr.input_count AS inputCount,
        sr.success_count AS successCount,
        sr.failed_count AS failedCount,
        sr.started_at AS startedAt,
        sr.last_heartbeat_at AS lastHeartbeatAt,
        (
          SELECT MAX(activity_at)
          FROM (
            SELECT MAX(created_at) AS activity_at
            FROM step_run_items
            WHERE step_run_id = sr.id
            UNION ALL
            SELECT MAX(created_at) AS activity_at
            FROM llm_call_logs
            WHERE step_run_id = sr.id
          )
        ) AS lastActivityAt
      FROM step_runs sr
      WHERE sr.status = 'running'
        AND sr.step_type IN ('extract_reasons', 'classify', 'classify_retry', 'iterate_others_extract', 'iterate_others_classify', 'one_click_classify')
    `)
    .all() as ReconcileCandidate[];

  for (const run of candidates) {
    const referenceTime = run.lastHeartbeatAt || run.lastActivityAt || run.startedAt;
    if (referenceTime > cutoff) {
      continue;
    }

    const itemCount = (
      db.prepare(`SELECT COUNT(*) AS count FROM step_run_items WHERE step_run_id = ?`).get(run.id) as { count: number }
    ).count;
    const logCount = (
      db.prepare(`SELECT COUNT(*) AS count FROM llm_call_logs WHERE step_run_id = ?`).get(run.id) as { count: number }
    ).count;
    const tracedCount = Math.max(itemCount, logCount, run.successCount + run.failedCount);
    const recoveredFailedCount = Math.max(run.inputCount - tracedCount, run.failedCount);
    const recoveredSuccessCount = Math.min(run.successCount, tracedCount);
    const finalStatus =
      recoveredSuccessCount === 0 && recoveredFailedCount > 0
        ? "failed"
        : recoveredFailedCount > 0
          ? "partial_success"
          : "succeeded";
    const finishedAt = new Date().toISOString();

    db.prepare(`
      UPDATE step_runs
      SET status = @status, success_count = @successCount, failed_count = @failedCount, finished_at = @finishedAt
      WHERE id = @id AND status = 'running'
    `).run({
      id: run.id,
      status: finalStatus,
      successCount: recoveredSuccessCount,
      failedCount: recoveredFailedCount,
      finishedAt,
    });

    if (run.batchId) {
      const batchStatus = mapRecoveredBatchStatus(run.stepType, recoveredSuccessCount, recoveredFailedCount);
      if (batchStatus) {
        db.prepare(`
          UPDATE batches
          SET status = @status, updated_at = @updatedAt
          WHERE id = @batchId
        `).run({
          batchId: run.batchId,
          status: batchStatus,
          updatedAt: finishedAt,
        });
      }
    }
  }
}
