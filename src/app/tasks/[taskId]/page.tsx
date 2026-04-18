import { notFound } from "next/navigation";

import { BatchDetailPanel } from "@/components/batch-detail-panel";
import { BatchProgressTable } from "@/components/batch-progress-table";
import { TaskBatchSelectionMemory } from "@/components/task-batch-selection-memory";
import { TaskIterateResume } from "@/components/task-iterate-resume";
import { TaskConvergencePanel } from "@/components/task-convergence-panel";
import { TaskLiveRefresh } from "@/components/task-live-refresh";
import { TaskOverviewHeader } from "@/components/task-overview-header";
import { TaskWorkspaceTabs } from "@/components/task-workspace-tabs";
import type {
  BatchCategoryCount,
  BatchSummary,
  CategorySample,
  CategorySummary,
  ClusterSuggestion,
  ExtractionSample,
  MergeSuggestion,
  StepRunSummary,
  SummaryItem,
  TaskSummary,
} from "@/components/task-workspace-types";
import { db } from "@/lib/db";
import { reconcileStalledStepRuns } from "@/lib/step-run-utils";
import { getCurrentUser } from "@/lib/current-user";

type TaskPageProps = {
  params: Promise<{
    taskId: string;
  }>;
  searchParams?: Promise<{
    importError?: string;
    mergeError?: string;
    tab?: string;
    batchId?: string;
  }>;
};

const summaryChartColors = [
  "#0f766e",
  "#b45309",
  "#0284c7",
  "#be123c",
  "#4f46e5",
  "#15803d",
  "#7c3aed",
  "#a16207",
];
const SUMMARY_CHART_RADIUS = 128;

function mapLatestByKey<T>(rows: T[], getKey: (row: T) => string) {
  const mapped = new Map<string, T>();

  for (const row of rows) {
    const key = getKey(row);
    if (!mapped.has(key)) {
      mapped.set(key, row);
    }
  }

  return mapped;
}

function formatStatusLabel(status: string | null | undefined) {
  if (!status) {
    return "未开始";
  }

  const mapping: Record<string, string> = {
    imported: "已导入",
    extracting: "提取中",
    reasons_extracted: "已提取",
    extract_partial: "部分失败",
    extract_failed: "失败",
    clustering: "聚类中",
    cluster_suggested: "待确认建议",
    cluster_empty: "无建议",
    cluster_failed: "失败",
    classifying: "分类中",
    categorized: "已分类",
    has_others: "有其他待处理",
    classify_partial: "部分失败",
    classify_failed: "失败",
    completed: "已完成",
    failed: "失败",
    running: "进行中",
    succeeded: "已完成",
    partial_success: "部分完成",
  };

  return mapping[status] ?? status;
}

function hasClassifyRun(run: StepRunSummary | undefined, counts: BatchCategoryCount[]) {
  return Boolean(run) || counts.some((row) => row.categoryName && row.categoryName !== "未分类");
}

function isRecentActivity(value: string | null | undefined, withinMs = 15000) {
  if (!value) {
    return false;
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return false;
  }

  return Date.now() - timestamp <= withinMs;
}

function isActiveRun(status: string | null | undefined) {
  return status === "running";
}

export default async function TaskPage({ params, searchParams }: TaskPageProps) {
  const { userId } = await getCurrentUser();
  reconcileStalledStepRuns();

  const { taskId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const importError = resolvedSearchParams?.importError;
  const mergeError = resolvedSearchParams?.mergeError;
  const activeTab = resolvedSearchParams?.tab === "convergence" ? "convergence" : "batches";

  const task = db
    .prepare(`
      SELECT
        id,
        name,
        description,
        llm_provider AS llmProvider,
        analysis_goal AS analysisGoal,
        analysis_focus_label AS analysisFocusLabel,
        (
          SELECT COUNT(*)
          FROM dialogs
          WHERE task_id = tasks.id
        ) AS dialogCount,
        (
          SELECT COUNT(*)
          FROM batches
          WHERE task_id = tasks.id
        ) AS batchCount
      FROM tasks
      WHERE id = ? AND user_id = ?
    `)
    .get(taskId, userId) as TaskSummary | undefined;

  if (!task) {
    notFound();
  }

  const batches = db
    .prepare(`
      SELECT
        id,
        file_name AS fileName,
        workflow_mode AS workflowMode,
        source_id_column AS sourceIdColumn,
        source_text_column AS sourceTextColumn,
        row_count AS rowCount,
        imported_count AS importedCount,
        duplicate_count AS duplicateCount,
        status,
        created_at AS createdAt
      FROM batches
      WHERE task_id = ?
      ORDER BY created_at DESC
    `)
    .all(taskId) as BatchSummary[];

  const categories = (
    db
      .prepare(`
        SELECT
          c.id,
          c.name,
          c.definition,
          c.is_other AS isOther,
          c.updated_by AS updatedBy,
          COUNT(r.id) AS hitCount
        FROM categories c
        LEFT JOIN dialog_analysis_results r ON r.category_id = c.id
        WHERE c.task_id = ? AND c.status = 'active'
        GROUP BY c.id, c.name, c.definition, c.is_other, c.updated_by, c.created_at
        ORDER BY c.is_other ASC, c.created_at ASC
      `)
      .all(taskId) as CategorySummary[]
  ).map((category) => ({
    ...category,
    hitCount: Number(category.hitCount),
  }));

  const resultCounts = db
    .prepare(`
      SELECT category_id AS categoryId, COUNT(*) AS count
      FROM dialog_analysis_results
      WHERE task_id = ?
      GROUP BY category_id
    `)
    .all(taskId) as Array<{ categoryId: string | null; count: number }>;

  const countMap = new Map(resultCounts.map((item) => [item.categoryId ?? "none", item.count]));

  const latestMergeRun = db
    .prepare(`
      SELECT
        id,
        batch_id AS batchId,
        status,
        round_no AS roundNo,
        input_count AS inputCount,
        success_count AS successCount,
        failed_count AS failedCount,
        finished_at AS finishedAt
      FROM step_runs
      WHERE task_id = ? AND batch_id IS NULL AND step_type = 'merge_categories'
      ORDER BY started_at DESC
      LIMIT 1
    `)
    .get(taskId) as StepRunSummary | undefined;

  const mergeSuggestions = latestMergeRun
    ? (db
        .prepare(`
          SELECT
            id,
            suggested_name AS suggestedName,
            suggested_definition AS suggestedDefinition,
            source_category_names_json AS sourceCategoryNamesJson,
            status
          FROM category_merge_suggestion_items
          WHERE task_id = ? AND merge_run_id = ? AND status = 'suggested'
          ORDER BY created_at ASC
        `)
        .all(taskId, latestMergeRun.id) as MergeSuggestion[])
    : [];

  const extractRuns = db
    .prepare(`
      SELECT
        id,
        batch_id AS batchId,
        status,
        round_no AS roundNo,
        input_count AS inputCount,
        success_count AS successCount,
        failed_count AS failedCount,
        finished_at AS finishedAt
      FROM step_runs
      WHERE task_id = ? AND step_type IN ('extract_reasons', 'extract_reasons_retry')
      ORDER BY started_at DESC
      LIMIT 20
    `)
    .all(taskId) as StepRunSummary[];

  const latestExtractRunByBatch = mapLatestByKey(extractRuns, (run) => run.batchId ?? "");

  const clusterRuns = db
    .prepare(`
      SELECT
        id,
        batch_id AS batchId,
        status,
        round_no AS roundNo,
        input_count AS inputCount,
        success_count AS successCount,
        failed_count AS failedCount,
        finished_at AS finishedAt
      FROM step_runs
      WHERE task_id = ? AND step_type = 'cluster_reasons'
      ORDER BY started_at DESC
      LIMIT 20
    `)
    .all(taskId) as StepRunSummary[];

  const latestClusterRunByBatch = mapLatestByKey(clusterRuns, (run) => run.batchId ?? "");

  const clusterSuggestions = db
    .prepare(`
      SELECT
        id,
        batch_id AS batchId,
        name,
        definition,
        example_reasons_json AS exampleReasonsJson,
        status,
        updated_at AS updatedAt
      FROM category_suggestions
      WHERE task_id = ?
      ORDER BY updated_at DESC
      LIMIT 50
    `)
    .all(taskId) as ClusterSuggestion[];

  const suggestionsByBatch = new Map<string, ClusterSuggestion[]>();
  for (const suggestion of clusterSuggestions) {
    const key = suggestion.batchId ?? "";
    const group = suggestionsByBatch.get(key) ?? [];
    group.push(suggestion);
    suggestionsByBatch.set(key, group);
  }

  const classifyRuns = db
    .prepare(`
      SELECT
        id,
        batch_id AS batchId,
        status,
        round_no AS roundNo,
        input_count AS inputCount,
        success_count AS successCount,
        failed_count AS failedCount,
        finished_at AS finishedAt
      FROM step_runs
      WHERE task_id = ? AND step_type IN ('classify', 'classify_retry')
      ORDER BY started_at DESC
      LIMIT 20
    `)
    .all(taskId) as StepRunSummary[];

  const latestClassifyRunByBatch = mapLatestByKey(classifyRuns, (run) => run.batchId ?? "");

  const oneClickRuns = db
    .prepare(`
      SELECT
        id,
        batch_id AS batchId,
        step_type AS stepType,
        status,
        round_no AS roundNo,
        input_count AS inputCount,
        success_count AS successCount,
        failed_count AS failedCount,
        started_at AS startedAt,
        finished_at AS finishedAt
      FROM step_runs
      WHERE task_id = ? AND step_type = 'one_click_classify'
      ORDER BY started_at DESC
    `)
    .all(taskId) as StepRunSummary[];

  const latestOneClickRunByBatch = mapLatestByKey(oneClickRuns, (run) => run.batchId ?? "");

  const iterateRuns = db
    .prepare(`
      SELECT
        id,
        batch_id AS batchId,
        step_type AS stepType,
        status,
        round_no AS roundNo,
        input_count AS inputCount,
        success_count AS successCount,
        failed_count AS failedCount,
        started_at AS startedAt,
        finished_at AS finishedAt
      FROM step_runs
      WHERE task_id = ? AND step_type IN ('iterate_others_extract', 'iterate_others_cluster', 'iterate_others_classify')
      ORDER BY started_at DESC
      LIMIT 40
    `)
    .all(taskId) as Array<StepRunSummary & { stepType: string; startedAt: string }>;

  const taskLevelIterateRuns = iterateRuns.filter((run) => !run.batchId);
  const latestTaskIterateExtractRun = taskLevelIterateRuns.find(
    (run) => run.stepType === "iterate_others_extract",
  );
  const latestTaskIterateClusterRun = latestTaskIterateExtractRun
    ? taskLevelIterateRuns.find(
        (run) =>
          run.stepType === "iterate_others_cluster" &&
          run.startedAt >= latestTaskIterateExtractRun.startedAt,
      )
    : undefined;
  const latestTaskIterateClassifyRun = latestTaskIterateExtractRun
    ? taskLevelIterateRuns.find(
        (run) =>
          run.stepType === "iterate_others_classify" &&
          run.startedAt >= latestTaskIterateExtractRun.startedAt,
      )
    : undefined;
  const currentTaskIterateRound = latestTaskIterateExtractRun?.roundNo ?? null;
  const iterateBridgeToCluster =
    !!latestTaskIterateExtractRun &&
    (latestTaskIterateExtractRun.status === "partial_success" ||
      latestTaskIterateExtractRun.status === "succeeded") &&
    !latestTaskIterateClusterRun &&
    isRecentActivity(latestTaskIterateExtractRun.finishedAt);
  const iterateBridgeToClassify =
    !!latestTaskIterateClusterRun &&
    (latestTaskIterateClusterRun.status === "partial_success" ||
      latestTaskIterateClusterRun.status === "succeeded") &&
    !latestTaskIterateClassifyRun &&
    isRecentActivity(latestTaskIterateClusterRun.finishedAt);
  const iterateNeedsResumeToCluster =
    !!latestTaskIterateExtractRun &&
    (latestTaskIterateExtractRun.status === "partial_success" ||
      latestTaskIterateExtractRun.status === "succeeded") &&
    !latestTaskIterateClusterRun &&
    !iterateBridgeToCluster;
  const iterateNeedsResumeToClassify =
    !!latestTaskIterateClusterRun &&
    (latestTaskIterateClusterRun.status === "partial_success" ||
      latestTaskIterateClusterRun.status === "succeeded") &&
    !latestTaskIterateClassifyRun &&
    !iterateBridgeToClassify;
  const iterateFlowActive =
    iterateRuns.some((run) => isActiveRun(run.status)) ||
    iterateBridgeToCluster ||
    iterateBridgeToClassify ||
    iterateNeedsResumeToCluster ||
    iterateNeedsResumeToClassify;

  const batchCategoryCounts = db
    .prepare(`
      SELECT
        batch_id AS batchId,
        category_name_snapshot AS categoryName,
        COUNT(*) AS count
      FROM dialog_analysis_results
      WHERE task_id = ? AND category_name_snapshot IS NOT NULL
      GROUP BY batch_id, category_name_snapshot
    `)
    .all(taskId) as Array<{
    batchId: string;
    categoryName: string | null;
    count: number;
  }>;

  const countsByBatch = new Map<string, BatchCategoryCount[]>();
  for (const row of batchCategoryCounts) {
    const group = countsByBatch.get(row.batchId) ?? [];
    group.push({ categoryName: row.categoryName, count: row.count });
    countsByBatch.set(row.batchId, group);
  }

  const getBatchCategoryRows = (batchId: string) => countsByBatch.get(batchId) ?? [];
  const getBatchOtherCount = (batchId: string) =>
    getBatchCategoryRows(batchId).find((row) => row.categoryName === "其他")?.count ?? 0;

  const extractionPreviewRows = db
    .prepare(`
      SELECT
        ranked.batchId,
        ranked.sourceDialogId,
        ranked.analysisSummary,
        ranked.evidenceQuote,
        ranked.updatedAt
      FROM (
        SELECT
          d.batch_id AS batchId,
          d.source_dialog_id AS sourceDialogId,
          COALESCE(r.buy_block_reason, '') AS analysisSummary,
          COALESCE(r.evidence_quote, '') AS evidenceQuote,
          r.updated_at AS updatedAt,
          ROW_NUMBER() OVER (
            PARTITION BY d.batch_id
            ORDER BY r.updated_at DESC
          ) AS rowNo
        FROM dialog_analysis_results r
        JOIN dialogs d ON d.id = r.dialog_id
        WHERE r.task_id = ? AND r.buy_block_reason IS NOT NULL AND r.buy_block_reason <> ''
      ) ranked
      WHERE ranked.rowNo <= 3
      ORDER BY ranked.updatedAt DESC
    `)
    .all(taskId) as Array<{
    batchId: string;
    sourceDialogId: string;
    analysisSummary: string;
    evidenceQuote: string;
    updatedAt: string;
  }>;

  const extractionSamplesByBatch = new Map<string, ExtractionSample[]>();
  for (const row of extractionPreviewRows) {
    const group = extractionSamplesByBatch.get(row.batchId) ?? [];
    group.push({
      sourceDialogId: row.sourceDialogId,
      analysisSummary: row.analysisSummary,
      evidenceQuote: row.evidenceQuote,
    });
    extractionSamplesByBatch.set(row.batchId, group);
  }

  const batchRunsActive =
    extractRuns.some((run) => isActiveRun(run.status)) ||
    clusterRuns.some((run) => isActiveRun(run.status)) ||
    classifyRuns.some((run) => isActiveRun(run.status)) ||
    oneClickRuns.some((run) => isActiveRun(run.status));
  const hasActiveRuns =
    isActiveRun(latestMergeRun?.status) ||
    batchRunsActive ||
    iterateFlowActive;

  const getBatchActiveConflict = (batchId: string) => {
    if (isActiveRun(latestMergeRun?.status)) {
      return "当前任务正在合并近似类别，请等待完成后再执行批次操作。";
    }

    if (iterateFlowActive) {
      if (isActiveRun(latestTaskIterateExtractRun?.status) || iterateBridgeToCluster) {
        return "当前任务正在处理“全部其他”的提取与聚类，请等待完成后再执行批次操作。";
      }

      if (isActiveRun(latestTaskIterateClusterRun?.status) || iterateBridgeToClassify) {
        return "当前任务正在处理“全部其他”的聚类与重分，请等待完成后再执行批次操作。";
      }

      if (isActiveRun(latestTaskIterateClassifyRun?.status)) {
        return "当前任务正在处理“全部其他”的重分，请等待完成后再执行批次操作。";
      }
    }

    if (isActiveRun(latestTaskIterateExtractRun?.status)) {
      return "当前任务正在处理“全部其他”的重新提取，请等待完成后再执行批次操作。";
    }

    if (isActiveRun(latestTaskIterateClusterRun?.status)) {
      return "当前任务正在处理“全部其他”的聚类，请等待完成后再执行批次操作。";
    }

    if (isActiveRun(latestTaskIterateClassifyRun?.status)) {
      return "当前任务正在处理“全部其他”的重分，请等待完成后再执行批次操作。";
    }

    const extractRun = latestExtractRunByBatch.get(batchId);
    if (isActiveRun(extractRun?.status)) {
      return "当前批次正在提取分析信号，请等待完成后再执行其他步骤。";
    }

    const clusterRun = latestClusterRunByBatch.get(batchId);
    if (isActiveRun(clusterRun?.status)) {
      return "当前批次正在生成类别建议，请等待完成后再执行其他步骤。";
    }

    const classifyRun = latestClassifyRunByBatch.get(batchId);
    if (isActiveRun(classifyRun?.status)) {
      return "当前批次正在批量分类，请等待完成后再执行其他步骤。";
    }

    const oneClickRun = latestOneClickRunByBatch.get(batchId);
    if (isActiveRun(oneClickRun?.status)) {
      return "当前批次正在一键分类，请等待完成后再执行其他步骤。";
    }

    return null;
  };

  const mergedCategorySummary: SummaryItem[] = categories
    .map((category) => ({
      categoryName: category.name,
      count: countMap.get(category.id) ?? 0,
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return left.categoryName.localeCompare(right.categoryName, "zh-CN");
    });

  const uncategorizedCount = countMap.get("none") ?? 0;
  if (uncategorizedCount > 0) {
    mergedCategorySummary.push({
      categoryName: "未分类",
      count: uncategorizedCount,
    });
  }

  const mergedTotal = mergedCategorySummary.reduce((sum, item) => sum + item.count, 0);
  const totalOtherCount = batches.reduce((sum, batch) => sum + getBatchOtherCount(batch.id), 0);
  const totalOtherBatchCount = batches.filter((batch) => getBatchOtherCount(batch.id) > 0).length;
  const chartItems = mergedCategorySummary
    .filter((item) => item.count > 0)
    .map((item, index) => ({
      ...item,
      color: summaryChartColors[index % summaryChartColors.length],
    }));
  const chartCircumference = 2 * Math.PI * SUMMARY_CHART_RADIUS;
  const chartSegments = chartItems.reduce<
    Array<{ categoryName: string; color: string; segmentLength: number; segmentOffset: number }>
  >((segments, item) => {
    const usedLength = segments.reduce((sum, segment) => sum + segment.segmentLength, 0);
    const segmentLength = chartCircumference * (item.count / mergedTotal);

    segments.push({
      categoryName: item.categoryName,
      color: item.color,
      segmentLength,
      segmentOffset: -usedLength,
    });

    return segments;
  }, []);

  const sampleByCategory = db
    .prepare(`
      SELECT categoryName, sourceDialogId, analysisSummary
      FROM (
        SELECT
          COALESCE(r.category_name_snapshot, '未分类') AS categoryName,
          d.source_dialog_id AS sourceDialogId,
          COALESCE(r.buy_block_reason, '') AS analysisSummary,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(r.category_name_snapshot, '未分类')
            ORDER BY
              CASE WHEN LENGTH(TRIM(COALESCE(r.buy_block_reason, ''))) = 0 THEN 1 ELSE 0 END ASC,
              LENGTH(TRIM(COALESCE(r.buy_block_reason, ''))) DESC,
              r.updated_at DESC
          ) AS rowNo
        FROM dialog_analysis_results r
        JOIN dialogs d ON d.id = r.dialog_id
        WHERE r.task_id = ?
      )
      WHERE rowNo <= 2
      ORDER BY categoryName COLLATE NOCASE, sourceDialogId
    `)
    .all(taskId) as Array<{
    categoryName: string;
    sourceDialogId: string;
    analysisSummary: string;
  }>;

  const samplesByCategory = new Map<string, CategorySample[]>();
  for (const row of sampleByCategory) {
    const group = samplesByCategory.get(row.categoryName) ?? [];
    group.push({ sourceDialogId: row.sourceDialogId, analysisSummary: row.analysisSummary });
    samplesByCategory.set(row.categoryName, group);
  }

  const explicitBatchId = resolvedSearchParams?.batchId ?? null;
  const selectedBatch = explicitBatchId
    ? batches.find((batch) => batch.id === explicitBatchId) ?? null
    : null;

  const nextAction = (() => {
    const unextracted = batches.filter((batch) => !latestExtractRunByBatch.get(batch.id));
    const seedUnextracted = unextracted.filter((batch) => batch.workflowMode === "seed");
    if (seedUnextracted.length) {
      return {
        label: `建议下一步：先对 ${seedUnextracted.length} 个建类批次提取分析信号`,
        tab: "batches" as const,
      };
    }

    const seedNeedsCluster = batches.find((batch) => {
      if (batch.workflowMode !== "seed") {
        return false;
      }

      const clusterRun = latestClusterRunByBatch.get(batch.id);
      const suggestions = suggestionsByBatch.get(batch.id) ?? [];
      const hasConfirmedSuggestions = suggestions.some((item) => item.status === "confirmed");
      const hasPendingSuggestions = suggestions.some((item) => item.status === "suggested");

      return !clusterRun || clusterRun.status === "failed" || (!hasConfirmedSuggestions && !hasPendingSuggestions);
    });

    if (seedNeedsCluster) {
      return {
        label: `建议下一步：为 ${seedNeedsCluster.fileName} 生成或重试类别建议`,
        tab: "batches" as const,
      };
    }

    const pendingSuggestionBatch = batches.find((batch) => (suggestionsByBatch.get(batch.id) ?? []).some((item) => item.status === "suggested"));
    if (pendingSuggestionBatch) {
      return {
        label: `建议下一步：确认 ${pendingSuggestionBatch.fileName} 的类别建议`,
        tab: "batches" as const,
      };
    }

    const unclassified = batches.find((batch) => !latestClassifyRunByBatch.get(batch.id));
    if (unclassified) {
      return {
        label: `建议下一步：按最新类别表完成 ${unclassified.fileName} 的批量分类`,
        tab: "batches" as const,
      };
    }

    if (totalOtherCount > 0) {
      return {
        label: `建议下一步：处理全部其他，继续收敛类别体系`,
        tab: "convergence" as const,
      };
    }

    return {
      label: "建议下一步：查看汇总结果并导出明细",
      tab: "convergence" as const,
    };
  })();

  const batchRows = batches.map((batch) => {
    const extractRun = latestExtractRunByBatch.get(batch.id);
    const clusterRun = latestClusterRunByBatch.get(batch.id);
    const classifyRun = latestClassifyRunByBatch.get(batch.id);
    const oneClickRun = latestOneClickRunByBatch.get(batch.id);
    const suggestions = suggestionsByBatch.get(batch.id) ?? [];
    const pendingSuggestions = suggestions.filter((item) => item.status === "suggested");
    const otherCount = getBatchOtherCount(batch.id);
    const hasPriorClassification = hasClassifyRun(classifyRun, countsByBatch.get(batch.id) ?? []);
    const oneClickFailureIsStale =
      oneClickRun?.status === "failed" &&
      [extractRun, clusterRun, classifyRun].some(
        (run) => run?.startedAt && oneClickRun.startedAt && run.startedAt > oneClickRun.startedAt,
      );

    const primaryActionLabel = isActiveRun(oneClickRun?.status)
      ? "处理中"
      : oneClickRun?.status === "failed" && !oneClickFailureIsStale
        ? "失败重试"
        : hasPriorClassification
          ? "重新一键分类"
          : "一键分类";

    return {
      batch,
      workflowModeLabel: batch.workflowMode === "seed" ? "建类" : "直接分类",
      extractLabel: batch.workflowMode === "classify_only" ? "跳过" : formatStatusLabel(extractRun?.status),
      clusterLabel:
        batch.workflowMode === "classify_only"
          ? "跳过"
          : pendingSuggestions.length
            ? "待确认"
            : formatStatusLabel(clusterRun?.status),
      classifyLabel: formatStatusLabel(classifyRun?.status),
      otherCount,
      updatedAtLabel: new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date((classifyRun?.finishedAt || clusterRun?.finishedAt || extractRun?.finishedAt || batch.createdAt) as string)),
      primaryActionLabel,
      selected: selectedBatch?.id === batch.id,
    };
  });

  return (
    <main className="workspaceShell">
      <TaskLiveRefresh active={hasActiveRuns} intervalMs={8000} />
      <TaskIterateResume
        resumeUrl={`/api/tasks/${task.id}/iterate/resume`}
        shouldResume={iterateNeedsResumeToCluster || iterateNeedsResumeToClassify}
      />
      <TaskBatchSelectionMemory
        taskId={task.id}
        selectedBatchId={selectedBatch?.id}
        activeTab={activeTab}
      />
      <TaskOverviewHeader
        taskId={task.id}
        selectedBatchId={selectedBatch?.id}
        taskName={task.name}
        taskDescription={task.description}
        analysisGoal={task.analysisGoal}
        llmProvider={task.llmProvider}
        batchCount={task.batchCount}
        dialogCount={task.dialogCount}
        activeCategoryCount={categories.filter((category) => !category.isOther).length}
        otherCount={totalOtherCount}
        nextActionLabel={nextAction.label}
        nextActionTab={nextAction.tab}
      />

      <TaskWorkspaceTabs taskId={task.id} activeTab={activeTab} selectedBatchId={selectedBatch?.id} />

      {activeTab === "batches" ? (
        <section className="contentPanel workspaceMainPanel">
          {importError ? <p className="logError">{decodeURIComponent(importError)}</p> : null}
          <BatchProgressTable taskId={task.id} rows={batchRows} />
          <BatchDetailPanel
            taskId={task.id}
            batch={selectedBatch}
            extractRun={selectedBatch ? latestExtractRunByBatch.get(selectedBatch.id) : undefined}
            clusterRun={selectedBatch ? latestClusterRunByBatch.get(selectedBatch.id) : undefined}
            classifyRun={selectedBatch ? latestClassifyRunByBatch.get(selectedBatch.id) : undefined}
            oneClickRun={selectedBatch ? latestOneClickRunByBatch.get(selectedBatch.id) : undefined}
            suggestions={selectedBatch ? suggestionsByBatch.get(selectedBatch.id) ?? [] : []}
            categoryCounts={selectedBatch ? getBatchCategoryRows(selectedBatch.id) : []}
            extractionSamples={selectedBatch ? extractionSamplesByBatch.get(selectedBatch.id) ?? [] : []}
            conflictReason={selectedBatch ? getBatchActiveConflict(selectedBatch.id) : null}
            analysisGoal={task.analysisGoal}
            analysisFocusLabel={task.analysisFocusLabel}
          />
          <article className="panel">
            <div className="sectionHeader">
              <div>
                <p className="eyebrow">Import Batch</p>
                <h2>上传 CSV 批次</h2>
              </div>
            </div>
            <form
              action={`/api/tasks/${task.id}/upload`}
              method="post"
              encType="multipart/form-data"
              className="stack"
            >
              <input type="hidden" name="taskId" value={task.id} />
              <label className="field">
                <span>CSV 文件</span>
                <input name="files" type="file" accept=".csv,text/csv" multiple required />
              </label>
              <p className="hint">
                支持一次上传最多 10 个 UTF-8 CSV 批次。系统默认读取每个文件的第 1 列作为 id，第 2 列作为 text。
              </p>
              <button type="submit" className="primaryButton">
                导入批次文件
              </button>
            </form>
          </article>
        </section>
      ) : (
        <TaskConvergencePanel
          taskId={task.id}
          analysisGoal={task.analysisGoal}
          analysisFocusLabel={task.analysisFocusLabel}
          categories={categories}
          latestMergeRun={latestMergeRun}
          mergeSuggestions={mergeSuggestions}
          totalOtherCount={totalOtherCount}
          totalOtherBatchCount={totalOtherBatchCount}
          latestTaskIterateExtractRun={latestTaskIterateExtractRun}
          latestTaskIterateClusterRun={latestTaskIterateClusterRun}
          latestTaskIterateClassifyRun={latestTaskIterateClassifyRun}
          currentTaskIterateRound={currentTaskIterateRound}
          iterateBridgeToCluster={iterateBridgeToCluster}
          iterateBridgeToClassify={iterateBridgeToClassify}
          iterateNeedsResumeToCluster={iterateNeedsResumeToCluster}
          iterateNeedsResumeToClassify={iterateNeedsResumeToClassify}
          iterateFlowActive={iterateFlowActive}
          mergedCategorySummary={mergedCategorySummary}
          mergedTotal={mergedTotal}
          batchesCount={batches.length}
          samplesByCategory={samplesByCategory}
          chartSegments={chartSegments}
          chartCircumference={chartCircumference}
          summaryChartColors={summaryChartColors}
          hasActiveRuns={hasActiveRuns}
          batchRunsActive={batchRunsActive}
          mergeError={mergeError ? decodeURIComponent(mergeError) : undefined}
        />
      )}
    </main>
  );
}
