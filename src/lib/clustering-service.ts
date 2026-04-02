import { randomUUID } from "node:crypto";

import type { AppSettings } from "@/lib/app-config";
import { db } from "@/lib/db";
import { clusterReasonsWithMiniMax } from "@/lib/llm/clustering";
import { failRunningStepRuns, failStepRun } from "@/lib/step-run-utils";
import type { PromptSettings } from "@/lib/prompt-config";

type ReasonRow = {
  dialogId: string;
  buyBlockReason: string;
};

type TaskAnalysisConfig = {
  analysisGoal: string;
  analysisFocusLabel: string;
};

function mapClusterBatchStatus(suggestionCount: number) {
  return suggestionCount > 0 ? "cluster_suggested" : "cluster_empty";
}

function mapExtractBatchStatus(successCount: number, failedCount: number) {
  if (successCount > 0 && failedCount === 0) {
    return "reasons_extracted";
  }

  if (successCount > 0 && failedCount > 0) {
    return "extract_partial";
  }

  return "extract_failed";
}

export async function generateClusterSuggestions(
  taskId: string,
  batchId: string | null,
  stepType = "cluster_reasons",
  sourceStepRunId?: string,
  settings?: AppSettings,
  promptSettings?: PromptSettings,
) {
  const reasons = (
    batchId
      ? db
          .prepare(`
            SELECT dialog_id AS dialogId, buy_block_reason AS buyBlockReason
            FROM dialog_analysis_results
            WHERE task_id = ? AND batch_id = ? AND result_status = 'reasons_extracted' AND COALESCE(buy_block_reason, '') <> ''
          `)
          .all(taskId, batchId)
      : sourceStepRunId
        ? db
            .prepare(`
              SELECT dialog_id AS dialogId, buy_block_reason AS buyBlockReason
              FROM dialog_analysis_results
              WHERE task_id = ?
                AND source_step_run_id = ?
                AND result_status = 'reasons_extracted'
                AND COALESCE(buy_block_reason, '') <> ''
            `)
            .all(taskId, sourceStepRunId)
        : db
          .prepare(`
            SELECT dialog_id AS dialogId, buy_block_reason AS buyBlockReason
            FROM dialog_analysis_results
            WHERE task_id = ? AND result_status = 'reasons_extracted' AND COALESCE(buy_block_reason, '') <> ''
          `)
          .all(taskId)
  ) as ReasonRow[];

  if (!reasons.length) {
    throw new Error(batchId ? "当前批次还没有可聚类的原因，请先完成原因提取" : "当前任务还没有可聚类的原因，请先完成原因提取");
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
      id, task_id, batch_id, step_type, round_no, status, input_count, success_count, failed_count, started_at
    ) VALUES (
      @id, @taskId, @batchId, @stepType, @roundNo, 'running', @inputCount, 0, 0, @startedAt
    )
  `).run({
    id: stepRunId,
    taskId,
    batchId,
    stepType,
    roundNo: latestRound.latestRound + 1,
    inputCount: reasons.length,
    startedAt: now,
  });

  if (batchId) {
    db.prepare(`UPDATE batches SET status = 'clustering', updated_at = ? WHERE id = ?`).run(now, batchId);
    db.prepare(`DELETE FROM category_suggestions WHERE task_id = ? AND batch_id = ? AND status = 'suggested'`).run(taskId, batchId);
  } else {
    db.prepare(`DELETE FROM category_suggestions WHERE task_id = ? AND batch_id IS NULL AND status = 'suggested'`).run(taskId);
  }

  try {
    const clusterResponse = await clusterReasonsWithMiniMax(
      reasons.map((item) => item.buyBlockReason),
      taskConfig.analysisGoal,
      taskConfig.analysisFocusLabel,
      settings!,
      promptSettings!,
    );
    const finishedAt = new Date().toISOString();
    const llmApiKey = settings!.llmApiKey;

    const insertSuggestion = db.prepare(`
    INSERT INTO category_suggestions (
      id, task_id, batch_id, source_step_run_id, name, definition, example_reasons_json, status, created_at, updated_at
    ) VALUES (
      @id, @taskId, @batchId, @sourceStepRunId, @name, @definition, @exampleReasonsJson, 'suggested', @createdAt, @updatedAt
    )
  `);
    const insertRunItem = db.prepare(`
    INSERT INTO step_run_items (
      id, step_run_id, dialog_id, raw_output_json, parsed_status, error_message, created_at
    ) VALUES (
      @id, @stepRunId, NULL, @rawOutputJson, @parsedStatus, @errorMessage, @createdAt
    )
  `);
    const insertLog = db.prepare(`
    INSERT INTO llm_call_logs (
      id, task_id, step_run_id, dialog_id, call_type, provider, model, prompt_text, response_text, status, latency_ms, created_at
    ) VALUES (
      @id, @taskId, @stepRunId, NULL, 'cluster', @provider, @model, @promptText, @responseText, @status, @latencyMs, @createdAt
    )
  `);

    db.transaction(() => {
      insertRunItem.run({
        id: randomUUID(),
        stepRunId,
        rawOutputJson: JSON.stringify(clusterResponse.categories),
        parsedStatus: clusterResponse.log.status === "succeeded" ? "parsed" : "failed",
        errorMessage: clusterResponse.log.status === "failed" ? clusterResponse.log.responseText : null,
        createdAt: finishedAt,
      });

      insertLog.run({
        id: randomUUID(),
        taskId,
        stepRunId,
        provider: clusterResponse.log.provider,
        model: clusterResponse.log.model,
        promptText: clusterResponse.log.promptText,
        responseText: clusterResponse.log.responseText,
        status: clusterResponse.log.status,
        latencyMs: clusterResponse.log.latencyMs,
        createdAt: finishedAt,
      });

      for (const category of clusterResponse.categories) {
        insertSuggestion.run({
          id: randomUUID(),
          taskId,
          batchId,
          sourceStepRunId: stepRunId,
          name: category.name,
          definition: category.definition,
          exampleReasonsJson: JSON.stringify(category.exampleReasons),
          createdAt: finishedAt,
          updatedAt: finishedAt,
        });
      }

      db.prepare(`
      UPDATE step_runs
      SET status = @status, success_count = @successCount, failed_count = @failedCount, finished_at = @finishedAt
      WHERE id = @id
    `).run({
        id: stepRunId,
        status: clusterResponse.log.status === "succeeded" ? "succeeded" : "failed",
        successCount: clusterResponse.categories.length,
        failedCount: clusterResponse.log.status === "succeeded" ? 0 : 1,
        finishedAt,
      });

      if (batchId) {
        db.prepare(`
        UPDATE batches
        SET status = @status, updated_at = @updatedAt
        WHERE id = @batchId
      `).run({
          batchId,
          status: mapClusterBatchStatus(clusterResponse.categories.length),
          updatedAt: finishedAt,
        });
      }

      db.prepare(`UPDATE tasks SET updated_at = ? WHERE id = ?`).run(finishedAt, taskId);
    })();

    return {
      stepRunId,
      suggestionCount: clusterResponse.categories.length,
      providerMode: llmApiKey ? "live" : "mock",
    };
  } catch (error) {
    failStepRun(stepRunId);

    if (batchId) {
      db.prepare(`UPDATE batches SET status = 'cluster_failed', updated_at = ? WHERE id = ?`).run(
        new Date().toISOString(),
        batchId,
      );
    }

    throw error;
  }
}

export async function confirmClusterSuggestions(taskId: string, batchId: string | null) {
  const suggestions = (
    batchId
      ? db
          .prepare(`
            SELECT id, name, definition
            FROM category_suggestions
            WHERE task_id = ? AND batch_id = ? AND status = 'suggested'
            ORDER BY created_at ASC
          `)
          .all(taskId, batchId)
      : db
          .prepare(`
            SELECT id, name, definition
            FROM category_suggestions
            WHERE task_id = ? AND batch_id IS NULL AND status = 'suggested'
            ORDER BY created_at ASC
          `)
          .all(taskId)
  ) as Array<{ id: string; name: string; definition: string }>;

  if (!suggestions.length) {
    throw new Error("当前没有待确认的类别建议");
  }

  const existingNames = new Set(
    (
      db.prepare(`SELECT name FROM categories WHERE task_id = ?`).all(taskId) as Array<{ name: string }>
    ).map((item) => item.name),
  );

  const now = new Date().toISOString();
  const insertCategory = db.prepare(`
    INSERT INTO categories (
      id, task_id, name, definition, status, created_from_round, is_other, updated_by, created_at, updated_at
    ) VALUES (
      @id, @taskId, @name, @definition, 'active', 0, 0, 'llm', @createdAt, @updatedAt
    )
  `);

  let createdCount = 0;

  db.transaction(() => {
    for (const suggestion of suggestions) {
      if (!existingNames.has(suggestion.name)) {
        insertCategory.run({
          id: randomUUID(),
          taskId,
          name: suggestion.name,
          definition: suggestion.definition,
          createdAt: now,
          updatedAt: now,
        });
        existingNames.add(suggestion.name);
        createdCount += 1;
      }
    }

    if (batchId) {
      db.prepare(`
        UPDATE category_suggestions
        SET status = 'confirmed', updated_at = ?
        WHERE task_id = ? AND batch_id = ? AND status = 'suggested'
      `).run(now, taskId, batchId);

      db.prepare(`
        UPDATE batches
        SET status = 'categories_updated', updated_at = ?
        WHERE id = ?
      `).run(now, batchId);
    } else {
      db.prepare(`
        UPDATE category_suggestions
        SET status = 'confirmed', updated_at = ?
        WHERE task_id = ? AND batch_id IS NULL AND status = 'suggested'
      `).run(now, taskId);
    }

    db.prepare(`UPDATE tasks SET updated_at = ? WHERE id = ?`).run(now, taskId);
  })();

  return {
    createdCount,
  };
}

export async function discardClusterSuggestions(taskId: string, batchId: string | null) {
  const suggestions = (
    batchId
      ? db
          .prepare(`
            SELECT id
            FROM category_suggestions
            WHERE task_id = ? AND batch_id = ? AND status = 'suggested'
            ORDER BY created_at ASC
          `)
          .all(taskId, batchId)
      : db
          .prepare(`
            SELECT id
            FROM category_suggestions
            WHERE task_id = ? AND batch_id IS NULL AND status = 'suggested'
            ORDER BY created_at ASC
          `)
          .all(taskId)
  ) as Array<{ id: string }>;

  if (!suggestions.length) {
    throw new Error("当前没有可废弃的类别建议");
  }

  const latestExtractRun = batchId
    ? (db
        .prepare(`
          SELECT success_count AS successCount, failed_count AS failedCount
          FROM step_runs
          WHERE task_id = ? AND batch_id = ? AND step_type IN ('extract_reasons', 'extract_reasons_retry')
          ORDER BY started_at DESC
          LIMIT 1
        `)
        .get(taskId, batchId) as { successCount: number; failedCount: number } | undefined)
    : undefined;

  const revertedBatchStatus = latestExtractRun
    ? mapExtractBatchStatus(latestExtractRun.successCount, latestExtractRun.failedCount)
    : "imported";
  const now = new Date().toISOString();

  db.transaction(() => {
    if (batchId) {
      db.prepare(`
        UPDATE category_suggestions
        SET status = 'discarded', updated_at = ?
        WHERE task_id = ? AND batch_id = ? AND status = 'suggested'
      `).run(now, taskId, batchId);

      db.prepare(`
        UPDATE batches
        SET status = ?, updated_at = ?
        WHERE id = ?
      `).run(revertedBatchStatus, now, batchId);
    } else {
      db.prepare(`
        UPDATE category_suggestions
        SET status = 'discarded', updated_at = ?
        WHERE task_id = ? AND batch_id IS NULL AND status = 'suggested'
      `).run(now, taskId);
    }

    db.prepare(`UPDATE tasks SET updated_at = ? WHERE id = ?`).run(now, taskId);
  })();

  return {
    discardedCount: suggestions.length,
  };
}
