import {
  confirmClusterSuggestionsAction,
  discardClusterSuggestionsAction,
  updateBatchWorkflowModeAction,
} from "@/app/actions";
import { AsyncStepButton } from "@/components/async-step-button";
import type {
  BatchCategoryCount,
  BatchSummary,
  ClusterSuggestion,
  ExtractionSample,
  StepRunSummary,
} from "@/components/task-workspace-types";

type BatchDetailPanelProps = {
  taskId: string;
  batch: BatchSummary | null;
  extractRun?: StepRunSummary;
  clusterRun?: StepRunSummary;
  classifyRun?: StepRunSummary;
  oneClickRun?: StepRunSummary;
  suggestions: ClusterSuggestion[];
  categoryCounts: BatchCategoryCount[];
  extractionSamples: ExtractionSample[];
  conflictReason: string | null;
  analysisGoal: string;
  analysisFocusLabel: string;
};

function formatRunStatus(status: string | null | undefined) {
  if (!status) {
    return "未开始";
  }

  const mapping: Record<string, string> = {
    running: "进行中",
    succeeded: "已完成",
    partial_success: "部分完成",
    failed: "失败",
  };

  return mapping[status] ?? status;
}

function getProgress(run?: StepRunSummary) {
  if (!run) {
    return 0;
  }

  if (run.status === "succeeded" || run.status === "partial_success" || run.status === "failed") {
    return 100;
  }

  if (!run.inputCount) {
    return 0;
  }

  return Math.min(100, Math.round(((run.successCount + run.failedCount) / run.inputCount) * 100));
}

function formatTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatWorkflowMode(mode: BatchSummary["workflowMode"]) {
  return mode === "seed" ? "建类" : "直接分类";
}

function getRunMeta(run: StepRunSummary | undefined, statusOverride?: string | null) {
  const status = statusOverride ?? run?.status;
  if (!status) {
    return "尚无时间记录";
  }

  if (status === "running" && run?.inputCount) {
    return `已完成 ${run.successCount + run.failedCount}/${run.inputCount}`;
  }

  return formatTime(run?.finishedAt) || "尚无时间记录";
}

function startedAfter(run: StepRunSummary | undefined, startedAt: string | undefined) {
  if (!run?.startedAt || !startedAt) {
    return false;
  }

  return run.startedAt > startedAt;
}

function getLatestStartedRun(runs: Array<StepRunSummary | undefined>) {
  return runs.reduce<StepRunSummary | undefined>((latest, run) => {
    if (!run) {
      return latest;
    }

    if (!latest) {
      return run;
    }

    if (!latest.startedAt) {
      return run.startedAt ? run : latest;
    }

    if (!run.startedAt) {
      return latest;
    }

    if (run.startedAt > latest.startedAt) {
      return run;
    }

    return latest;
  }, undefined);
}

type OneClickStageKey = "extract" | "cluster" | "confirm" | "classify";

const seedOneClickStages: Array<{ key: OneClickStageKey; label: string }> = [
  { key: "extract", label: "提取分析信号" },
  { key: "cluster", label: "生成类别建议" },
  { key: "confirm", label: "写入类别表" },
  { key: "classify", label: "批量分类" },
];

const classifyOnlyStages: Array<{ key: OneClickStageKey; label: string }> = [
  { key: "classify", label: "批量分类" },
];

export function BatchDetailPanel({
  taskId,
  batch,
  extractRun,
  clusterRun,
  classifyRun,
  oneClickRun,
  suggestions,
  categoryCounts,
  extractionSamples,
  conflictReason,
  analysisGoal,
  analysisFocusLabel,
}: BatchDetailPanelProps) {
  if (!batch) {
    return (
      <div className="panel batchDetailPanel">
        <div className="emptyState">
          <h3>先选择一个批次</h3>
          <p>从上方批次表中选中一个批次，再查看其当前状态和可执行操作。</p>
        </div>
      </div>
    );
  }

  const pendingSuggestions = suggestions.filter((item) => item.status === "suggested");
  const hasClassifiedBefore = categoryCounts.some((row) => row.categoryName && row.categoryName !== "未分类");
  const hasConflict = Boolean(conflictReason);
  const oneClickFailureIsStale =
    oneClickRun?.status === "failed" &&
    [extractRun, clusterRun, classifyRun].some((run) => startedAfter(run, oneClickRun.startedAt));
  const effectiveOneClickStatus = oneClickFailureIsStale ? undefined : oneClickRun?.status;
  const activeSubStepStatus =
    extractRun?.status === "running"
      ? extractRun.status
      : clusterRun?.status === "running"
        ? clusterRun.status
        : classifyRun?.status === "running"
          ? classifyRun.status
          : undefined;
  const latestSubStepRun = getLatestStartedRun([extractRun, clusterRun, classifyRun]);
  const latestOverallStatus =
    effectiveOneClickStatus ??
    activeSubStepStatus ??
    (oneClickFailureIsStale ? latestSubStepRun?.status : undefined) ??
    classifyRun?.status ??
    (pendingSuggestions.length ? "pending_suggestions" : undefined) ??
    clusterRun?.status ??
    extractRun?.status ??
    batch.status;
  const distributionText = categoryCounts.length
    ? [...categoryCounts]
        .sort((left, right) => right.count - left.count)
        .map((row) => `${row.categoryName || "未分类"}：${row.count}条`)
        .join("  ")
    : "当前还没有分类结果。";
  const extractFailedCount = extractRun?.failedCount ?? 0;
  const classifyFailedCount = classifyRun?.failedCount ?? 0;
  const clusterActionLabel = clusterRun?.status === "failed" ? "重试生成类别建议" : "生成类别建议";
  const classifyActionLabel = hasClassifiedBefore ? "重新批量分类" : "开始批量分类";
  const oneClickActive = effectiveOneClickStatus === "running";
  const oneClickFailed = effectiveOneClickStatus === "failed";
  const oneClickStages = batch.workflowMode === "seed" ? seedOneClickStages : classifyOnlyStages;
  const oneClickStage: OneClickStageKey =
    batch.workflowMode === "classify_only"
      ? "classify"
      : extractRun?.status === "running"
        ? "extract"
        : clusterRun?.status === "running"
          ? "cluster"
          : pendingSuggestions.length
            ? "confirm"
            : classifyRun?.status === "running"
              ? "classify"
              : oneClickFailed && clusterRun?.status === "failed"
                ? "cluster"
                : oneClickFailed && extractRun?.status === "failed"
                  ? "extract"
                  : oneClickFailed && classifyRun?.status === "failed"
                    ? "classify"
                    : "classify";
  const oneClickStageIndex = Math.max(
    0,
    oneClickStages.findIndex((stage) => stage.key === oneClickStage),
  );
  const primaryAction = {
    label: hasClassifiedBefore ? "重新一键分类" : "一键分类",
    endpoint: `/api/tasks/${taskId}/batches/${batch.id}/one-click-classify`,
  };
  const operationSummary =
    batch.workflowMode === "seed"
      ? pendingSuggestions.length
        ? "当前已有待确认的类别建议，一键分类会继续完成写入与分类。"
        : `一键分类会按建类流程提取${analysisFocusLabel}、生成建议并完成分类。`
      : "一键分类会跳过建类阶段，直接套用当前类别表完成归类。";
  const resultStage =
    batch.workflowMode === "seed" && extractRun?.status === "running"
      ? "extract"
      : batch.workflowMode === "seed" && clusterRun?.status === "running"
        ? "cluster"
        : classifyRun?.status === "running"
          ? "classify"
          : batch.workflowMode === "classify_only"
            ? "classify"
            : pendingSuggestions.length
              ? "cluster"
              : !extractRun || !clusterRun
                ? "extract"
                : !classifyRun
                  ? "cluster"
                  : "classify";
  const activeProgressRun =
    batch.workflowMode === "seed" && extractRun?.status === "running"
      ? {
          title: `正在提取${analysisFocusLabel}`,
          copy: `已完成 ${extractRun.successCount + extractRun.failedCount}/${extractRun.inputCount}`,
          progress: getProgress(extractRun),
        }
      : batch.workflowMode === "seed" && clusterRun?.status === "running"
        ? {
            title: "正在生成类别建议",
            copy: "类别建议生成中，请等待模型返回。",
            progress: 100,
            indeterminate: true,
          }
        : classifyRun?.status === "running"
          ? {
              title: "正在批量分类",
              copy: `已完成 ${classifyRun.successCount + classifyRun.failedCount}/${classifyRun.inputCount}`,
              progress: getProgress(classifyRun),
            }
          : null;
  const timelineRows = [
    {
      label: "1. 导入",
      value: "已导入",
      meta: `${batch.importedCount} 条`,
    },
    {
      label: "2. 信号提取",
      value: batch.workflowMode === "classify_only" ? "跳过" : formatRunStatus(extractRun?.status),
      meta: batch.workflowMode === "seed" ? getRunMeta(extractRun) : null,
    },
    {
      label: "3. 聚类建议",
      value: batch.workflowMode === "classify_only" ? "跳过" : pendingSuggestions.length ? "待确认" : formatRunStatus(clusterRun?.status),
      meta:
        batch.workflowMode === "seed"
          ? pendingSuggestions.length
            ? "等待确认"
            : getRunMeta(clusterRun)
          : null,
    },
    {
      label: "4. 批量分类",
      value: formatRunStatus(classifyRun?.status),
      meta: getRunMeta(classifyRun),
    },
  ];

  return (
    <div className="panel batchDetailPanel">
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">Batch Detail</p>
          <h2>{batch.fileName}</h2>
          <p className="hint batchHeaderHint">{operationSummary}</p>
        </div>
        <span className="badge">当前用途：{formatWorkflowMode(batch.workflowMode)}</span>
      </div>

      <div className="taskStats batchDetailStats">
        <span>当前状态：{formatRunStatus(latestOverallStatus)}</span>
        <span>已导入 {batch.importedCount} 条</span>
        <span>批次用途：{formatWorkflowMode(batch.workflowMode)}</span>
      </div>

      <form action={updateBatchWorkflowModeAction} className="batchModeForm">
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="batchId" value={batch.id} />
        <label className="field inlineField">
          <span>批次用途</span>
          <select name="workflowMode" defaultValue={batch.workflowMode} disabled={hasConflict}>
            <option value="seed">建类</option>
            <option value="classify_only">直接分类</option>
          </select>
        </label>
        <button type="submit" className="secondaryButton" disabled={hasConflict}>
          更新批次用途
        </button>
      </form>
      {hasConflict ? <p className="hint">当前有任务正在运行，暂不能修改批次用途。</p> : null}

      <div className="batchTimeline">
        {timelineRows.map((item) => (
          <div key={item.label} className="timelineItem">
            <strong>{item.label}</strong>
            <span className="timelineValue">{item.value}</span>
            <span className="timelineMeta">{item.meta || "尚无时间记录"}</span>
          </div>
        ))}
      </div>

      <div className="grid batchDetailHeroGrid">
        <section className="resultCard batchPrimaryCard batchActionCard">
          <div className="taskCardHeader">
            <div>
              <p className="eyebrow">Primary Action</p>
              <h3>一键分类</h3>
              <p>默认按当前批次用途自动推进完整流程。</p>
            </div>
          </div>
          {oneClickActive || oneClickFailed ? (
            <div className="oneClickProgressPanel">
              <div className="oneClickStageTrack">
                {oneClickStages.map((stage, index) => (
                  <span
                    key={stage.key}
                    className={`oneClickStage ${
                      index < oneClickStageIndex
                        ? "oneClickStageDone"
                        : index === oneClickStageIndex
                          ? oneClickFailed
                            ? "oneClickStageFailed"
                            : "oneClickStageActive"
                          : ""
                    }`}
                  >
                    {stage.label}
                  </span>
                ))}
              </div>
              <p className={oneClickFailed ? "logError" : "progressCopy"}>
                {oneClickFailed
                  ? `一键分类未完成，失败步骤：${oneClickStages[oneClickStageIndex]?.label ?? "未知步骤"}`
                  : `一键分类进行中，步骤 ${oneClickStageIndex + 1}/${oneClickStages.length}：正在${oneClickStages[oneClickStageIndex]?.label}`}
              </p>
            </div>
          ) : null}
          {activeProgressRun ? (
            <div className="progressPanel">
              <div className="progressBar">
                <div
                  className={`progressValue progressActive ${activeProgressRun.indeterminate ? "progressIndeterminate" : ""}`}
                  style={{ width: `${activeProgressRun.progress}%` }}
                />
              </div>
              <p className="progressCopy">
                {activeProgressRun.title} · {activeProgressRun.copy}
              </p>
            </div>
          ) : null}
          <AsyncStepButton
            endpoint={primaryAction.endpoint}
            label={primaryAction.label}
            disabled={hasConflict}
          />
          {conflictReason ? <p className="hint">{conflictReason}</p> : null}
          <details className="advancedActions">
            <summary>高级操作</summary>
            <div className="stack compactStack">
              {batch.workflowMode === "seed" ? (
                <div className="actionRow">
                  <AsyncStepButton
                    endpoint={`/api/tasks/${taskId}/batches/${batch.id}/extract`}
                    label={extractRun ? "重新提取" : "提取分析信号"}
                    className="secondaryButton"
                    disabled={hasConflict}
                  />
                  {extractFailedCount > 0 ? (
                    <AsyncStepButton
                      endpoint={`/api/tasks/${taskId}/batches/${batch.id}/extract/retry-failed`}
                      label="重试提取失败"
                      className="ghostButton"
                      disabled={hasConflict}
                    />
                  ) : null}
                  <AsyncStepButton
                    endpoint={`/api/tasks/${taskId}/batches/${batch.id}/cluster`}
                    label={clusterActionLabel}
                    className="secondaryButton"
                    disabled={hasConflict}
                  />
                </div>
              ) : null}
              <div className="actionRow">
                <AsyncStepButton
                  endpoint={`/api/tasks/${taskId}/batches/${batch.id}/classify`}
                  label={classifyActionLabel}
                  className="secondaryButton"
                  disabled={hasConflict}
                />
                {classifyFailedCount > 0 ? (
                  <AsyncStepButton
                    endpoint={`/api/tasks/${taskId}/batches/${batch.id}/classify/retry-failed`}
                    label="重试分类失败"
                    className="ghostButton"
                    disabled={hasConflict}
                  />
                ) : null}
              </div>
              {batch.workflowMode === "seed" && pendingSuggestions.length ? (
                <div className="actionRow">
                  <form action={confirmClusterSuggestionsAction}>
                    <input type="hidden" name="taskId" value={taskId} />
                    <input type="hidden" name="batchId" value={batch.id} />
                    <button type="submit" className="primaryButton" disabled={hasConflict}>
                      确认建议写入类别表
                    </button>
                  </form>
                  <form action={discardClusterSuggestionsAction}>
                    <input type="hidden" name="taskId" value={taskId} />
                    <input type="hidden" name="batchId" value={batch.id} />
                    <button type="submit" className="ghostButton" disabled={hasConflict}>
                      废弃
                    </button>
                  </form>
                </div>
              ) : null}
            </div>
          </details>
        </section>

        <section className="resultCard batchPrimaryCard">
          <div className="taskCardHeader">
            <div>
              <p className="eyebrow">Latest Result</p>
              <h3>
                {resultStage === "extract"
                  ? `最新${analysisFocusLabel}提取结果`
                  : resultStage === "cluster"
                    ? "最新聚类建议"
                    : "最新分类结果"}
              </h3>
              <p>
                {resultStage === "extract"
                  ? `这里展示最近一轮${analysisFocusLabel}提取结果，便于判断提取口径是否稳定。`
                  : resultStage === "cluster"
                    ? "这里展示当前批次最新的聚类建议，便于确认类别是否可写入类别表。"
                    : "按该批次当前生效结果汇总，优先看这里判断这轮是否达到预期。"}
              </p>
            </div>
          </div>
          {resultStage === "extract" ? (
            extractionSamples.length ? (
              <div className="stack compactStack">
                {extractionSamples.map((sample) => (
                  <article key={`${sample.sourceDialogId}-${sample.evidenceQuote}`} className="resultCard nestedResultCard">
                    <h3>{sample.sourceDialogId}</h3>
                    <p>{sample.analysisSummary}</p>
                    {sample.evidenceQuote ? <p className="quoteBlock">引用：{sample.evidenceQuote}</p> : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="hint">当前还没有可展示的提取结果，完成一轮信号提取后这里会更新。</p>
            )
          ) : resultStage === "cluster" ? (
            pendingSuggestions.length ? (
              <div className="stack compactStack">
                {pendingSuggestions.map((suggestion) => {
                  const examples = suggestion.exampleReasonsJson
                    ? (JSON.parse(suggestion.exampleReasonsJson) as string[])
                    : [];

                  return (
                    <article key={`preview-${suggestion.id}`} className="resultCard nestedResultCard">
                      <h3>{suggestion.name}</h3>
                      <p>{suggestion.definition}</p>
                      {examples.length ? <p className="quoteBlock">例如：{examples.join("；")}</p> : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="hint">当前还没有待确认的聚类建议，生成完成后这里会展示建议内容。</p>
            )
          ) : (
            <>
              <p className="quoteBlock batchResultQuote">{distributionText}</p>
              {classifyRun ? (
                <div className="progressPanel">
                  <div className="progressBar">
                    <div
                      className={`progressValue ${classifyRun.status === "running" ? "progressActive" : ""}`}
                      style={{ width: `${getProgress(classifyRun)}%` }}
                    />
                  </div>
                  <p className="progressCopy">
                    {classifyRun.status === "running"
                      ? `正在分类，已完成 ${classifyRun.successCount + classifyRun.failedCount}/${classifyRun.inputCount}`
                      : `最近一轮分类：${formatRunStatus(classifyRun.status)}${formatTime(classifyRun.finishedAt) ? ` · ${formatTime(classifyRun.finishedAt)}` : ""}`}
                  </p>
                </div>
              ) : (
                <p className="hint">当前还没有完成过批量分类，这里会在第一次分类后展示稳定分布。</p>
              )}
            </>
          )}
        </section>
      </div>

      <div className="grid batchDetailGrid">
        {batch.workflowMode === "seed" ? (
          <section className="resultCard batchSecondaryCard batchSecondaryCardWide">
            <div className="taskCardHeader">
              <div>
                <p className="eyebrow">Suggestions</p>
                <h3>待确认类别建议</h3>
                <p>仅展示当前批次最近一轮待确认建议。</p>
              </div>
              <span className="badge">{pendingSuggestions.length} 条</span>
            </div>
            {pendingSuggestions.length ? (
              <div className="stack compactStack">
                {pendingSuggestions.map((suggestion) => {
                  const examples = suggestion.exampleReasonsJson
                    ? (JSON.parse(suggestion.exampleReasonsJson) as string[])
                    : [];

                  return (
                    <article key={suggestion.id} className="resultCard nestedResultCard">
                      <h3>{suggestion.name}</h3>
                      <p>{suggestion.definition}</p>
                      {examples.length ? <p className="quoteBlock">例如：{examples.join("；")}</p> : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="hint">当前没有待确认的类别建议。若聚类刚失败，主操作区会直接提供“重试生成类别建议”。</p>
            )}
          </section>
        ) : (
          <section className="resultCard batchSecondaryCard batchSecondaryCardWide">
            <div className="taskCardHeader">
              <div>
                <p className="eyebrow">Classification Mode</p>
                <h3>直接分类说明</h3>
                <p>该批次跳过建类阶段，直接围绕“{analysisGoal}”使用当前类别表完成归类。</p>
              </div>
            </div>
            <p className="quoteBlock">
              当前流程会直接使用任务最新类别表进行归类；如果分类后“其他”数量偏高，请到“任务收敛”Tab 统一处理全部其他。
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
