import { randomUUID } from "node:crypto";

import type { AppSettings } from "@/lib/app-config";
import { db } from "@/lib/db";
import { withHeartbeat } from "@/lib/heartbeat";
import { recordFailedExtractionAttempt } from "@/lib/extraction-log-writer";
import { getExtractionCategoryAssignment } from "@/lib/extraction-category-assignment";
import { ExtractionParseError } from "@/lib/llm/extraction-parser";
import { extractReasonWithMiniMax } from "@/lib/llm/minimax";
import type { ExtractionRequest } from "@/lib/llm/types";
import { failRunningStepRuns, failStepRun } from "@/lib/step-run-utils";
import type { PromptSettings } from "@/lib/prompt-config";

type BatchDialogRow = {
  id: string;
  batchId: string;
  sourceDialogId: string;
  sourceText: string;
};

type TaskAnalysisConfig = {
  analysisGoal: string;
  analysisFocusLabel: string;
};

type ExtractionRunLookup = {
  id: string;
  stepType: string;
};

function mapBatchStatus(successCount: number, failedCount: number) {
  if (successCount > 0 && failedCount === 0) {
    return "reasons_extracted";
  }

  if (successCount > 0 && failedCount > 0) {
    return "extract_partial";
  }

  return "extract_failed";
}

export async function runReasonExtraction(taskId: string, batchId: string, settings: AppSettings, promptSettings: PromptSettings) {
  const dialogs = db
    .prepare(`
      SELECT id, batch_id AS batchId, source_dialog_id AS sourceDialogId, source_text AS sourceText
      FROM dialogs
      WHERE task_id = ? AND batch_id = ?
      ORDER BY created_at ASC
    `)
    .all(taskId, batchId) as BatchDialogRow[];

  return runReasonExtractionForDialogs(taskId, batchId, dialogs, "extract_reasons", settings, promptSettings);
}

export async function retryFailedReasonExtraction(taskId: string, batchId: string, settings: AppSettings, promptSettings: PromptSettings) {
  const latestRun = db
    .prepare(`
      SELECT id, step_type AS stepType
      FROM step_runs
      WHERE task_id = ? AND batch_id = ? AND step_type IN ('extract_reasons', 'extract_reasons_retry')
      ORDER BY started_at DESC
      LIMIT 1
    `)
    .get(taskId, batchId) as ExtractionRunLookup | undefined;

  if (!latestRun) {
    throw new Error("当前批次还没有可重试的提取记录");
  }

  const dialogs = db
    .prepare(`
      SELECT
        d.id,
        d.batch_id AS batchId,
        d.source_dialog_id AS sourceDialogId,
        d.source_text AS sourceText
      FROM dialogs d
      LEFT JOIN step_run_items sri
        ON sri.dialog_id = d.id
       AND sri.step_run_id = @stepRunId
      WHERE d.task_id = @taskId
        AND d.batch_id = @batchId
        AND (
          sri.id IS NULL
          OR sri.parsed_status = 'failed'
          OR COALESCE(sri.error_message, '') <> ''
        )
      ORDER BY d.created_at ASC
    `)
    .all({
      taskId,
      batchId,
      stepRunId: latestRun.id,
    }) as BatchDialogRow[];

  if (!dialogs.length) {
    throw new Error("当前批次没有可重试的失败条目");
  }

  return runReasonExtractionForDialogs(taskId, batchId, dialogs, "extract_reasons_retry", settings, promptSettings);
}

export async function runReasonExtractionForDialogs(
  taskId: string,
  batchId: string | null,
  dialogs: BatchDialogRow[],
  stepType = "extract_reasons",
  settings: AppSettings,
  promptSettings: PromptSettings,
) {
  if (!dialogs.length) {
    throw new Error(batchId ? "当前批次没有可提取的对话" : "当前任务没有可提取的对话");
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
  ) as { latestRound: number };

  const now = new Date().toISOString();
  const stepRunId = randomUUID();

  failRunningStepRuns({
    taskId,
    batchId,
    stepType,
  });

  db.prepare(`
    INSERT INTO step_runs (
      id, task_id, batch_id, step_type, round_no, status, input_count, success_count, failed_count, started_at, last_heartbeat_at
    ) VALUES (
      @id, @taskId, @batchId, @stepType, @roundNo, 'running', @inputCount, 0, 0, @startedAt, @lastHeartbeatAt
    )
  `).run({
    id: stepRunId,
    taskId,
    batchId,
    stepType,
    roundNo: latestRound.latestRound + 1,
    inputCount: dialogs.length,
    startedAt: now,
    lastHeartbeatAt: now,
  });

  if (batchId) {
    db.prepare(`UPDATE batches SET status = 'extracting', updated_at = ? WHERE id = ?`).run(now, batchId);
  }

  const taskConfig = db
    .prepare(`
      SELECT
        analysis_goal AS analysisGoal,
        analysis_focus_label AS analysisFocusLabel
      FROM tasks
      WHERE id = ?
    `)
    .get(taskId) as TaskAnalysisConfig | undefined;

  if (!taskConfig) {
    throw new Error("任务不存在");
  }
  const { analysisGoal, analysisFocusLabel } = taskConfig;

  try {
    const insertRunItem = db.prepare(`
    INSERT INTO step_run_items (
      id, step_run_id, dialog_id, raw_output_json, parsed_status, error_message, created_at
    ) VALUES (
      @id, @stepRunId, @dialogId, @rawOutputJson, @parsedStatus, @errorMessage, @createdAt
    )
  `);
  const insertLog = db.prepare(`
    INSERT INTO llm_call_logs (
      id, task_id, step_run_id, dialog_id, call_type, provider, model, prompt_text, response_text, status, latency_ms, created_at
    ) VALUES (
      @id, @taskId, @stepRunId, @dialogId, @callType, @provider, @model, @promptText, @responseText, @status, @latencyMs, @createdAt
    )
  `);
  const upsertResult = db.prepare(`
    INSERT INTO dialog_analysis_results (
      id, dialog_id, task_id, batch_id, category_id, category_name_snapshot, buy_block_reason, evidence_quote, evidence_explanation,
      source_step_run_id, result_status, review_status, updated_at
    ) VALUES (
      @id, @dialogId, @taskId, @batchId, @categoryId, @categoryNameSnapshot, @buyBlockReason, @evidenceQuote, @evidenceExplanation,
      @sourceStepRunId, @resultStatus, 'unreviewed', @updatedAt
    )
    ON CONFLICT(dialog_id) DO UPDATE SET
      category_id = CASE
        WHEN excluded.result_status = 'no_buy_block_reason' THEN dialog_analysis_results.category_id
        ELSE COALESCE(excluded.category_id, dialog_analysis_results.category_id)
      END,
      category_name_snapshot = CASE
        WHEN excluded.result_status = 'no_buy_block_reason' THEN dialog_analysis_results.category_name_snapshot
        ELSE COALESCE(excluded.category_name_snapshot, dialog_analysis_results.category_name_snapshot)
      END,
      buy_block_reason = excluded.buy_block_reason,
      evidence_quote = excluded.evidence_quote,
      evidence_explanation = excluded.evidence_explanation,
      source_step_run_id = excluded.source_step_run_id,
      result_status = excluded.result_status,
      updated_at = excluded.updated_at
  `);

    let successCount = 0;
    let failedCount = 0;
    const previewRows: Array<{
    sourceDialogId: string;
    resultStatus: string;
    buyBlockReason: string;
    evidenceQuote: string;
    }> = [];

    const { extractionConcurrency, llmApiKey, llmModel } = settings;
    const concurrency = Number(extractionConcurrency || 5);
    let cursor = 0;
    let lastProgressFlushAt = 0;
    const updateRunProgress = db.prepare(`
    UPDATE step_runs
    SET success_count = @successCount, failed_count = @failedCount, last_heartbeat_at = @lastHeartbeatAt
    WHERE id = @id
  `);
    const beatStepRun = db.prepare(`
    UPDATE step_runs
    SET last_heartbeat_at = @lastHeartbeatAt
    WHERE id = @id AND status = 'running'
  `);

    function flushRunProgress(force = false) {
      const nowTs = Date.now();
      if (!force && nowTs - lastProgressFlushAt < 1000) {
        return;
      }

      lastProgressFlushAt = nowTs;
      updateRunProgress.run({
        id: stepRunId,
        successCount,
        failedCount,
        lastHeartbeatAt: new Date(nowTs).toISOString(),
      });
    }

    async function worker() {
      while (cursor < dialogs.length) {
        const current = dialogs[cursor];
        cursor += 1;

        const request: ExtractionRequest = {
          dialogId: current.id,
          sourceDialogId: current.sourceDialogId,
          text: current.sourceText,
          analysisGoal,
          analysisFocusLabel,
        };

        try {
          const providerResponse = await extractReasonWithMiniMax(request, settings, promptSettings);
          const createdAt = new Date().toISOString();
          const parsedStatus = providerResponse.log.status === "succeeded" ? "parsed" : "failed";
          const resultStatus = providerResponse.result.hasTargetSignal ? "reasons_extracted" : "no_buy_block_reason";
          const categoryAssignment = getExtractionCategoryAssignment(resultStatus);

          db.transaction(() => {
            insertRunItem.run({
              id: randomUUID(),
              stepRunId,
              dialogId: current.id,
              rawOutputJson: JSON.stringify(providerResponse.result),
              parsedStatus,
              errorMessage: providerResponse.log.status === "failed" ? providerResponse.log.responseText : null,
              createdAt,
            });

            insertLog.run({
              id: randomUUID(),
              taskId,
              stepRunId,
              dialogId: current.id,
              callType: stepType === "iterate_others_extract" ? "extract_other" : "extract",
              provider: providerResponse.log.provider,
              model: providerResponse.log.model,
              promptText: providerResponse.log.promptText,
              responseText: providerResponse.log.responseText,
              status: providerResponse.log.status,
              latencyMs: providerResponse.log.latencyMs,
              createdAt,
            });

            upsertResult.run({
              id: randomUUID(),
              dialogId: current.id,
              taskId,
              batchId: current.batchId,
              categoryId: categoryAssignment.categoryId ?? null,
              categoryNameSnapshot: categoryAssignment.categoryNameSnapshot ?? null,
              buyBlockReason: providerResponse.result.analysisSummary,
              evidenceQuote: providerResponse.result.evidenceQuote,
              evidenceExplanation: providerResponse.result.evidenceExplanation,
              sourceStepRunId: stepRunId,
              resultStatus,
              updatedAt: createdAt,
            });
          })();

          if (providerResponse.log.status === "succeeded") {
            successCount += 1;
          } else {
            failedCount += 1;
          }

          flushRunProgress();

          if (previewRows.length < 5) {
            previewRows.push({
              sourceDialogId: current.sourceDialogId,
              resultStatus,
              buyBlockReason: providerResponse.result.analysisSummary,
              evidenceQuote: providerResponse.result.evidenceQuote,
            });
          }
        } catch (error) {
          const createdAt = new Date().toISOString();
          const message =
            error instanceof ExtractionParseError
              ? error.responseText
              : error instanceof Error
                ? error.message
                : "未知错误";
          failedCount += 1;

          recordFailedExtractionAttempt({
            db,
            stepRunId,
            dialogId: current.id,
            taskId,
            callType: stepType === "iterate_others_extract" ? "extract_other" : "extract",
            model: llmModel,
            errorMessage: message,
            createdAt,
          });

          flushRunProgress();
        }
      }
    }

    await withHeartbeat({
      intervalMs: 1000,
      beat: () => {
        beatStepRun.run({
          id: stepRunId,
          lastHeartbeatAt: new Date().toISOString(),
        });
      },
      run: () => Promise.all(Array.from({ length: Math.min(concurrency, dialogs.length) }, () => worker())),
    });

    flushRunProgress(true);

    const finalStatus =
      failedCount === 0 ? "succeeded" : successCount > 0 ? "partial_success" : "failed";
    const finishedAt = new Date().toISOString();

    db.transaction(() => {
      db.prepare(`
      UPDATE step_runs
      SET status = @status, success_count = @successCount, failed_count = @failedCount, finished_at = @finishedAt, last_heartbeat_at = @lastHeartbeatAt
      WHERE id = @id
    `).run({
      id: stepRunId,
      status: finalStatus,
      successCount,
      failedCount,
      finishedAt,
      lastHeartbeatAt: finishedAt,
    });

      if (batchId) {
        db.prepare(`
        UPDATE batches
        SET status = @status, updated_at = @updatedAt
        WHERE id = @batchId
      `).run({
        batchId,
        status: mapBatchStatus(successCount, failedCount),
        updatedAt: finishedAt,
      });
      }

      db.prepare(`UPDATE tasks SET updated_at = ? WHERE id = ?`).run(finishedAt, taskId);
    })();

    return {
      stepRunId,
      successCount,
      failedCount,
      previewRows,
      providerMode: llmApiKey ? "live" : "mock",
    };
  } catch (error) {
    failStepRun(stepRunId);

    if (batchId) {
      db.prepare(`UPDATE batches SET status = 'extract_failed', updated_at = ? WHERE id = ?`).run(
        new Date().toISOString(),
        batchId,
      );
    }

    throw error;
  }
}
