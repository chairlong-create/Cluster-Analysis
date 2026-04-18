import { confirmClusterSuggestions, generateClusterSuggestions } from "@/lib/clustering-service";
import { runBatchClassificationForDialogs } from "@/lib/classification-service";
import { db } from "@/lib/db";
import { runReasonExtractionForDialogs } from "@/lib/extraction-service";
import { recordFailedIterateResumeCheckpoint } from "@/lib/iterate-resume-checkpoint";
import type { AppSettings } from "@/lib/app-config";
import type { PromptSettings } from "@/lib/prompt-config";

type OtherDialogRow = {
  id: string;
  batchId: string;
  sourceDialogId: string;
  sourceText: string;
};

type ExtractedDialogRow = {
  dialogId: string;
  batchId: string;
  sourceDialogId: string;
  sourceText: string;
  extractedReason: string | null;
};

type IterateRunLookup = {
  id: string;
  stepType: string;
  status: string;
  roundNo: number;
  startedAt: string;
  finishedAt: string | null;
};

const NO_EXTRACTED_SIGNAL_MESSAGE = "重新提取没有产出可聚类的分析信号，请先处理失败项或调整提取 Prompt";

function getStepRunStartedAt(stepRunId: string) {
  const row = db
    .prepare(`
      SELECT started_at AS startedAt
      FROM step_runs
      WHERE id = ?
    `)
    .get(stepRunId) as { startedAt: string } | undefined;

  return row?.startedAt ?? new Date().toISOString();
}

function recordNoExtractedSignalsCheckpoint(taskId: string, batchId: string | null, sourceStepRunId: string) {
  recordFailedIterateResumeCheckpoint({
    db,
    taskId,
    batchId,
    stepType: "iterate_others_cluster",
    sourceStartedAt: getStepRunStartedAt(sourceStepRunId),
    inputCount: 0,
    errorMessage: NO_EXTRACTED_SIGNAL_MESSAGE,
  });
}

function getSuccessfullyExtractedDialogs(taskId: string, sourceStepRunId: string, dialogIds: string[]) {
  if (!dialogIds.length) {
    return [] as ExtractedDialogRow[];
  }

  return db
    .prepare(`
      SELECT
        d.id AS dialogId,
        d.batch_id AS batchId,
        d.source_dialog_id AS sourceDialogId,
        d.source_text AS sourceText,
        r.buy_block_reason AS extractedReason
      FROM dialogs d
      JOIN dialog_analysis_results r ON r.dialog_id = d.id
      WHERE d.id IN (${dialogIds.map(() => "?").join(",")})
        AND r.task_id = ?
        AND r.source_step_run_id = ?
        AND r.result_status = 'reasons_extracted'
        AND COALESCE(r.buy_block_reason, '') <> ''
      ORDER BY d.created_at ASC
    `)
    .all(...dialogIds, taskId, sourceStepRunId) as ExtractedDialogRow[];
}

function getSuccessfullyExtractedDialogsByStepRun(taskId: string, sourceStepRunId: string) {
  return db
    .prepare(`
      SELECT
        d.id AS dialogId,
        d.batch_id AS batchId,
        d.source_dialog_id AS sourceDialogId,
        d.source_text AS sourceText,
        r.buy_block_reason AS extractedReason
      FROM dialogs d
      JOIN dialog_analysis_results r ON r.dialog_id = d.id
      WHERE d.task_id = ?
        AND r.task_id = ?
        AND r.source_step_run_id = ?
        AND r.result_status = 'reasons_extracted'
        AND COALESCE(r.buy_block_reason, '') <> ''
      ORDER BY d.created_at ASC
    `)
    .all(taskId, taskId, sourceStepRunId) as ExtractedDialogRow[];
}

export async function iterateOtherDialogs(taskId: string, batchId: string, settings: AppSettings, promptSettings: PromptSettings) {
  const otherCategory = db
    .prepare(`
      SELECT id, name
      FROM categories
      WHERE task_id = ? AND is_other = 1
      LIMIT 1
    `)
    .get(taskId) as { id: string; name: string } | undefined;

  if (!otherCategory) {
    throw new Error("当前任务缺少系统“其他”类别");
  }

  const otherDialogs = db
    .prepare(`
      SELECT
        d.id,
        d.batch_id AS batchId,
        d.source_dialog_id AS sourceDialogId,
        d.source_text AS sourceText
      FROM dialogs d
      JOIN dialog_analysis_results r ON r.dialog_id = d.id
      WHERE d.task_id = ?
        AND d.batch_id = ?
        AND (
          r.result_status = 'classified_other'
          OR r.category_id = ?
          OR r.category_name_snapshot = ?
        )
      ORDER BY d.created_at ASC
    `)
    .all(taskId, batchId, otherCategory.id, otherCategory.name) as OtherDialogRow[];

  if (!otherDialogs.length) {
    throw new Error("当前批次没有落入“其他”的记录");
  }

  const extraction = await runReasonExtractionForDialogs(
    taskId,
    batchId,
    otherDialogs,
    "iterate_others_extract",
    settings,
    promptSettings,
  );
  const extractedDialogs = getSuccessfullyExtractedDialogs(
    taskId,
    extraction.stepRunId,
    otherDialogs.map((dialog) => dialog.id),
  );

  if (!extractedDialogs.length) {
    recordNoExtractedSignalsCheckpoint(taskId, batchId, extraction.stepRunId);
    throw new Error(NO_EXTRACTED_SIGNAL_MESSAGE);
  }

  const clustering = await generateClusterSuggestions(
    taskId,
    batchId,
    "iterate_others_cluster",
    extraction.stepRunId,
    settings,
    promptSettings,
  );
  const confirmed = await confirmClusterSuggestions(taskId, batchId);

  const classification = await runBatchClassificationForDialogs(
    taskId,
    batchId,
    extractedDialogs,
    "iterate_others_classify",
    settings,
    promptSettings,
  );

  return {
    targetedCount: otherDialogs.length,
    continuedCount: extractedDialogs.length,
    extraction,
    clustering,
    confirmed,
    classification,
  };
}

export async function iterateAllOtherDialogs(taskId: string, settings: AppSettings, promptSettings: PromptSettings) {
  const otherCategory = db
    .prepare(`
      SELECT id, name
      FROM categories
      WHERE task_id = ? AND is_other = 1
      LIMIT 1
    `)
    .get(taskId) as { id: string; name: string } | undefined;

  if (!otherCategory) {
    throw new Error("当前任务缺少系统“其他”类别");
  }

  const otherDialogs = db
    .prepare(`
      SELECT
        d.id,
        d.batch_id AS batchId,
        d.source_dialog_id AS sourceDialogId,
        d.source_text AS sourceText
      FROM dialogs d
      JOIN dialog_analysis_results r ON r.dialog_id = d.id
      WHERE d.task_id = ?
        AND (
          r.result_status = 'classified_other'
          OR r.category_id = ?
          OR r.category_name_snapshot = ?
        )
      ORDER BY d.created_at ASC
    `)
    .all(taskId, otherCategory.id, otherCategory.name) as OtherDialogRow[];

  if (!otherDialogs.length) {
    throw new Error("当前任务没有落入“其他”的记录");
  }

  const extraction = await runReasonExtractionForDialogs(
    taskId,
    null,
    otherDialogs,
    "iterate_others_extract",
    settings,
    promptSettings,
  );
  const extractedDialogs = getSuccessfullyExtractedDialogs(
    taskId,
    extraction.stepRunId,
    otherDialogs.map((dialog) => dialog.id),
  );

  if (!extractedDialogs.length) {
    recordNoExtractedSignalsCheckpoint(taskId, null, extraction.stepRunId);
    throw new Error(NO_EXTRACTED_SIGNAL_MESSAGE);
  }

  const clustering = await generateClusterSuggestions(
    taskId,
    null,
    "iterate_others_cluster",
    extraction.stepRunId,
    settings,
    promptSettings,
  );
  const confirmed = await confirmClusterSuggestions(taskId, null);

  const classification = await runBatchClassificationForDialogs(
    taskId,
    null,
    extractedDialogs,
    "iterate_others_classify",
    settings,
    promptSettings,
  );

  return {
    targetedCount: otherDialogs.length,
    continuedCount: extractedDialogs.length,
    affectedBatchCount: new Set(otherDialogs.map((dialog) => dialog.batchId)).size,
    extraction,
    clustering,
    confirmed,
    classification,
  };
}

export async function resumeInterruptedIterateAllDialogs(taskId: string, settings: AppSettings, promptSettings: PromptSettings) {
  const taskLevelIterateRuns = db
    .prepare(`
      SELECT
        id,
        step_type AS stepType,
        status,
        round_no AS roundNo,
        started_at AS startedAt,
        finished_at AS finishedAt
      FROM step_runs
      WHERE task_id = ?
        AND batch_id IS NULL
        AND step_type IN ('iterate_others_extract', 'iterate_others_cluster', 'iterate_others_classify')
      ORDER BY started_at DESC
      LIMIT 20
    `)
    .all(taskId) as IterateRunLookup[];

  if (taskLevelIterateRuns.some((run) => run.status === "running")) {
    return { resumed: false, reason: "already_running" as const };
  }

  const latestExtractRun = taskLevelIterateRuns.find((run) => run.stepType === "iterate_others_extract");
  if (!latestExtractRun || !["succeeded", "partial_success"].includes(latestExtractRun.status)) {
    return { resumed: false, reason: "no_extract_checkpoint" as const };
  }

  const latestClusterRun = taskLevelIterateRuns.find(
    (run) => run.stepType === "iterate_others_cluster" && run.startedAt >= latestExtractRun.startedAt,
  );
  const latestClassifyRun = taskLevelIterateRuns.find(
    (run) => run.stepType === "iterate_others_classify" && run.startedAt >= latestExtractRun.startedAt,
  );

  if (latestClassifyRun) {
    return { resumed: false, reason: "already_finished" as const };
  }

  const extractedDialogs = getSuccessfullyExtractedDialogsByStepRun(taskId, latestExtractRun.id);
  if (!extractedDialogs.length) {
    recordFailedIterateResumeCheckpoint({
      db,
      taskId,
      batchId: null,
      stepType: "iterate_others_cluster",
      sourceStartedAt: latestExtractRun.startedAt,
      inputCount: 0,
      errorMessage: NO_EXTRACTED_SIGNAL_MESSAGE,
    });
    return { resumed: false, reason: "no_extracted_dialogs" as const };
  }

  if (!latestClusterRun) {
    try {
      const clustering = await generateClusterSuggestions(
        taskId,
        null,
        "iterate_others_cluster",
        latestExtractRun.id,
        settings,
        promptSettings,
      );
      const confirmed = await confirmClusterSuggestions(taskId, null);
      const classification = await runBatchClassificationForDialogs(
        taskId,
        null,
        extractedDialogs,
        "iterate_others_classify",
        settings,
        promptSettings,
      );

      return {
        resumed: true,
        reason: "resumed_from_extract" as const,
        clustering,
        confirmed,
        classification,
      };
    } catch (error) {
      recordFailedIterateResumeCheckpoint({
        db,
        taskId,
        batchId: null,
        stepType: "iterate_others_cluster",
        sourceStartedAt: latestExtractRun.startedAt,
        inputCount: extractedDialogs.length,
        errorMessage: error instanceof Error ? error.message : "处理全部其他聚类续跑失败",
      });
      throw error;
    }
  }

  if (["failed"].includes(latestClusterRun.status)) {
    return { resumed: false, reason: "cluster_failed" as const };
  }

  let classification: Awaited<ReturnType<typeof runBatchClassificationForDialogs>>;
  try {
    classification = await runBatchClassificationForDialogs(
      taskId,
      null,
      extractedDialogs,
      "iterate_others_classify",
      settings,
      promptSettings,
    );
  } catch (error) {
    recordFailedIterateResumeCheckpoint({
      db,
      taskId,
      batchId: null,
      stepType: "iterate_others_classify",
      sourceStartedAt: latestClusterRun.startedAt,
      inputCount: extractedDialogs.length,
      errorMessage: error instanceof Error ? error.message : "处理全部其他重分续跑失败",
    });
    throw error;
  }

  return {
    resumed: true,
    reason: "resumed_from_cluster" as const,
    classification,
  };
}
