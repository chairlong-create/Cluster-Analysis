import { randomUUID } from "node:crypto";

import type { AppSettings } from "@/lib/app-config";
import { confirmClusterSuggestions, generateClusterSuggestions } from "@/lib/clustering-service";
import { runBatchClassification } from "@/lib/classification-service";
import { db } from "@/lib/db";
import { runReasonExtraction } from "@/lib/extraction-service";
import { planOneClickBatchSteps } from "@/lib/one-click-classification-plan";
import { failStepRun, failRunningStepRuns } from "@/lib/step-run-utils";
import type { PromptSettings } from "@/lib/prompt-config";

type BatchRow = {
  workflowMode: "seed" | "classify_only";
};

type StepRunRow = {
  status: string;
  successCount: number;
  failedCount: number;
};

type CountRow = {
  count: number;
};

function getLatestStepRun(taskId: string, batchId: string, stepTypes: string[]) {
  return db
    .prepare(`
      SELECT
        status,
        success_count AS successCount,
        failed_count AS failedCount
      FROM step_runs
      WHERE task_id = ?
        AND batch_id = ?
        AND step_type IN (${stepTypes.map(() => "?").join(",")})
      ORDER BY started_at DESC
      LIMIT 1
    `)
    .get(taskId, batchId, ...stepTypes) as StepRunRow | undefined;
}

function getSuggestionCount(taskId: string, batchId: string, status: "suggested" | "confirmed") {
  return (
    db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM category_suggestions
        WHERE task_id = ? AND batch_id = ? AND status = ?
      `)
      .get(taskId, batchId, status) as CountRow
  ).count;
}

export async function runOneClickBatchClassification(
  taskId: string,
  batchId: string,
  settings: AppSettings,
  promptSettings: PromptSettings,
) {
  const batch = db
    .prepare(`
      SELECT workflow_mode AS workflowMode
      FROM batches
      WHERE id = ? AND task_id = ?
      LIMIT 1
    `)
    .get(batchId, taskId) as BatchRow | undefined;

  if (!batch) {
    throw new Error("批次不存在或不属于当前任务");
  }

  const dialogCount = (
    db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM dialogs
        WHERE task_id = ? AND batch_id = ?
      `)
      .get(taskId, batchId) as CountRow
  ).count;

  const latestExtractionRun = getLatestStepRun(taskId, batchId, ["extract_reasons", "extract_reasons_retry"]);
  const latestClusterRun = getLatestStepRun(taskId, batchId, ["cluster_reasons"]);
  const pendingSuggestionCount = getSuggestionCount(taskId, batchId, "suggested");
  const confirmedSuggestionCount = getSuggestionCount(taskId, batchId, "confirmed");

  const workflowPlan = planOneClickBatchSteps({
    workflowMode: batch.workflowMode,
    hasSuccessfulExtraction: latestExtractionRun?.status === "succeeded" && (latestExtractionRun.successCount ?? 0) > 0,
    hasPendingSuggestions: pendingSuggestionCount > 0,
    hasConfirmedSuggestions: confirmedSuggestionCount > 0,
    hasSuccessfulClusterRun: latestClusterRun?.status === "succeeded",
    clusterReturnedEmpty: latestClusterRun?.status === "succeeded" && (latestClusterRun.successCount ?? 0) === 0,
  });

  const now = new Date().toISOString();
  const workflowRunId = randomUUID();

  failRunningStepRuns({
    taskId,
    batchId,
    stepType: "one_click_classify",
  });

  db.prepare(`
    INSERT INTO step_runs (
      id, task_id, batch_id, step_type, round_no, status, input_count, success_count, failed_count, started_at, last_heartbeat_at
    ) VALUES (
      @id, @taskId, @batchId, 'one_click_classify', @roundNo, 'running', @inputCount, 0, 0, @startedAt, @lastHeartbeatAt
    )
  `).run({
    id: workflowRunId,
    taskId,
    batchId,
    roundNo: (
      db
        .prepare(`
          SELECT COALESCE(MAX(round_no), 0) AS latestRound
          FROM step_runs
          WHERE task_id = ? AND batch_id = ? AND step_type = 'one_click_classify'
        `)
        .get(taskId, batchId) as { latestRound: number }
    ).latestRound + 1,
    inputCount: dialogCount,
    startedAt: now,
    lastHeartbeatAt: now,
  });

  try {
    let extractionResult: Awaited<ReturnType<typeof runReasonExtraction>> | undefined;
    let clusterResult: Awaited<ReturnType<typeof generateClusterSuggestions>> | undefined;
    let confirmationResult: Awaited<ReturnType<typeof confirmClusterSuggestions>> | undefined;
    let classificationResult: Awaited<ReturnType<typeof runBatchClassification>> | undefined;

    for (const step of workflowPlan) {
      if (step === "extract") {
        extractionResult = await runReasonExtraction(taskId, batchId, settings, promptSettings);
      } else if (step === "cluster") {
        clusterResult = await generateClusterSuggestions(taskId, batchId, "cluster_reasons", undefined, settings, promptSettings);
      } else if (step === "confirm") {
        if (getSuggestionCount(taskId, batchId, "suggested") > 0) {
          confirmationResult = await confirmClusterSuggestions(taskId, batchId);
        }
      } else {
        classificationResult = await runBatchClassification(taskId, batchId, settings, promptSettings);
      }
    }

    if (!classificationResult) {
      throw new Error("一键分类流程未进入分类步骤");
    }

    const finishedAt = new Date().toISOString();
    const finalStatus =
      classificationResult.failedCount === 0
        ? "succeeded"
        : classificationResult.successCount > 0
          ? "partial_success"
          : "failed";

    db.prepare(`
      UPDATE step_runs
      SET status = @status, success_count = @successCount, failed_count = @failedCount, finished_at = @finishedAt, last_heartbeat_at = @lastHeartbeatAt
      WHERE id = @id
    `).run({
      id: workflowRunId,
      status: finalStatus,
      successCount: classificationResult.successCount,
      failedCount: classificationResult.failedCount,
      finishedAt,
      lastHeartbeatAt: finishedAt,
    });

    return {
      workflowStepRunId: workflowRunId,
      workflowPlan,
      extractionResult,
      clusterResult,
      confirmationResult,
      classificationResult,
    };
  } catch (error) {
    failStepRun(workflowRunId);
    throw error;
  }
}
