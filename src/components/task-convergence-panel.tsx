import {
  applyCategoryMergeSuggestionsAction,
  discardCategoryMergeSuggestionsAction,
  generateCategoryMergeSuggestionsAction,
} from "@/app/actions";
import { AsyncStepButton } from "@/components/async-step-button";
import { CategorySnapshotTable } from "@/components/category-snapshot-table";
import { ExportCsvButton } from "@/components/export-csv-button";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import type {
  CategorySample,
  CategorySummary,
  MergeSuggestion,
  StepRunSummary,
  SummaryItem,
} from "@/components/task-workspace-types";
import { formatPercent } from "@/lib/task-utils";

type TaskConvergencePanelProps = {
  taskId: string;
  analysisGoal: string;
  analysisFocusLabel: string;
  categories: CategorySummary[];
  latestMergeRun?: StepRunSummary;
  mergeSuggestions: MergeSuggestion[];
  mergeError?: string;
  totalOtherCount: number;
  totalOtherBatchCount: number;
  latestTaskIterateExtractRun?: StepRunSummary;
  latestTaskIterateClusterRun?: StepRunSummary;
  latestTaskIterateClassifyRun?: StepRunSummary;
  currentTaskIterateRound: number | null;
  iterateBridgeToCluster: boolean;
  iterateBridgeToClassify: boolean;
  iterateNeedsResumeToCluster: boolean;
  iterateNeedsResumeToClassify: boolean;
  iterateFlowActive: boolean;
  mergedCategorySummary: SummaryItem[];
  mergedTotal: number;
  batchesCount: number;
  samplesByCategory: Map<string, CategorySample[]>;
  chartSegments: Array<{ categoryName: string; color: string; segmentLength: number; segmentOffset: number }>;
  chartCircumference: number;
  summaryChartColors: string[];
  hasActiveRuns: boolean;
  batchRunsActive: boolean;
};

function formatTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getRunProgress(run?: StepRunSummary) {
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

export function TaskConvergencePanel({
  taskId,
  analysisGoal,
  analysisFocusLabel,
  categories,
  latestMergeRun,
  mergeSuggestions,
  mergeError,
  totalOtherCount,
  totalOtherBatchCount,
  latestTaskIterateExtractRun,
  latestTaskIterateClusterRun,
  latestTaskIterateClassifyRun,
  currentTaskIterateRound,
  iterateBridgeToCluster,
  iterateBridgeToClassify,
  iterateNeedsResumeToCluster,
  iterateNeedsResumeToClassify,
  iterateFlowActive,
  mergedCategorySummary,
  mergedTotal,
  batchesCount,
  samplesByCategory,
  chartSegments,
  chartCircumference,
  summaryChartColors,
  hasActiveRuns,
  batchRunsActive,
}: TaskConvergencePanelProps) {
  const activeCategoryCount = categories.filter((category) => !category.isOther).length;
  const iterateExtractActive = latestTaskIterateExtractRun?.status === "running";
  const iterateClusterActive =
    latestTaskIterateClusterRun?.status === "running" || iterateBridgeToCluster || iterateNeedsResumeToCluster;
  const iterateClassifyActive =
    latestTaskIterateClassifyRun?.status === "running" || iterateBridgeToClassify || iterateNeedsResumeToClassify;
  const iterateProgress = iterateClassifyActive
    ? latestTaskIterateClassifyRun
      ? 70 + Math.round(getRunProgress(latestTaskIterateClassifyRun) * 0.3)
      : 72
    : iterateClusterActive
      ? latestTaskIterateClusterRun
        ? latestTaskIterateClusterRun.status === "running"
          ? 60
          : 68
        : 62
      : latestTaskIterateExtractRun
        ? latestTaskIterateExtractRun.status === "partial_success"
          ? 60
          : Math.round(getRunProgress(latestTaskIterateExtractRun) * 0.6)
        : 0;
  const iterateStatusText = iterateClassifyActive
    ? latestTaskIterateClassifyRun
      ? `正在重分全部“其他”，已完成 ${latestTaskIterateClassifyRun.successCount + latestTaskIterateClassifyRun.failedCount}/${latestTaskIterateClassifyRun.inputCount}`
      : "正在基于新类别建议启动全部“其他”的重分"
    : latestTaskIterateClassifyRun
      ? latestTaskIterateClassifyRun.status === "partial_success"
        ? `本轮重分已部分完成，成功 ${latestTaskIterateClassifyRun.successCount} 条，失败 ${latestTaskIterateClassifyRun.failedCount} 条`
        : totalOtherCount
          ? `本轮执行成功，但仍有 ${totalOtherCount} 条保持为“其他”`
          : "本轮执行成功，当前已无“其他”记录"
    : iterateClusterActive
      ? latestTaskIterateClusterRun
        ? "正在对全部“其他”生成新类别建议"
          : iterateNeedsResumeToCluster
            ? `重新提取已${latestTaskIterateExtractRun?.status === "partial_success" ? "部分" : ""}完成，正在恢复并继续生成新类别建议`
            : `重新提取已${latestTaskIterateExtractRun?.status === "partial_success" ? "部分" : ""}完成，正在基于成功结果生成新类别建议`
        : latestTaskIterateClusterRun
          ? latestTaskIterateClusterRun.status === "partial_success"
            ? "类别建议已部分生成，正在等待后续处理"
            : "类别建议已生成，准备进入重分"
          : latestTaskIterateExtractRun
            ? iterateExtractActive
              ? `正在重新提取全部“其他”的分析信号，已完成 ${latestTaskIterateExtractRun.successCount + latestTaskIterateExtractRun.failedCount}/${latestTaskIterateExtractRun.inputCount}`
              : latestTaskIterateExtractRun.status === "partial_success"
                ? `重新提取已部分完成，成功 ${latestTaskIterateExtractRun.successCount} 条，失败 ${latestTaskIterateExtractRun.failedCount} 条；已基于成功结果继续后续步骤`
                : "重新提取已完成，准备进入下一阶段"
            : "尚未开始处理全部“其他”";
	  const chartCallouts = mergedTotal
	    ? chartSegments.slice(0, 6).map((segment) => {
        const startLength = Math.abs(segment.segmentOffset);
        const midLength = startLength + segment.segmentLength / 2;
        const angle = (midLength / chartCircumference) * Math.PI * 2 - Math.PI / 2;
        const centerX = 260;
        const centerY = 220;
        const lineStartRadius = 148;
        const lineMidRadius = 182;
        const startX = centerX + Math.cos(angle) * lineStartRadius;
        const startY = centerY + Math.sin(angle) * lineStartRadius;
        const midX = centerX + Math.cos(angle) * lineMidRadius;
        const midY = centerY + Math.sin(angle) * lineMidRadius;
        const isRight = Math.cos(angle) >= 0;
        const endX = isRight ? 484 : 36;
        const textX = isRight ? endX + 8 : endX - 8;
	        const anchor: "start" | "end" = isRight ? "start" : "end";
        const meta = mergedCategorySummary.find((item) => item.categoryName === segment.categoryName);

        return {
          ...segment,
          startX,
          startY,
          midX,
          midY,
          endX,
          textX,
          textY: midY,
          anchor,
          count: meta?.count ?? 0,
          percent: formatPercent(meta?.count ?? 0, mergedTotal),
        };
      })
    : [];

  return (
    <div className="contentPanel convergencePanel">
      <article className="panel workspaceSectionPanel convergenceSnapshotPanel">
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">Category Snapshot</p>
            <h2>当前类别体系</h2>
          </div>
          <span className="badge">{activeCategoryCount} 个活跃类别</span>
        </div>
        {categories.length ? (
          <CategorySnapshotTable
            taskId={taskId}
            categories={categories}
            analysisFocusLabel={analysisFocusLabel}
            disabled={hasActiveRuns}
          />
        ) : (
          <div className="emptyState compactEmptyState">
            <p>当前还没有可展示的{analysisFocusLabel}类别。</p>
          </div>
        )}
      </article>

      <article className="panel workspaceSectionPanel convergenceActionPanel">
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">Task Optimization</p>
            <h2>处理全部其他</h2>
          </div>
          <span className={`badge ${totalOtherCount ? "" : "badgeMuted"}`}>{totalOtherCount} 条待处理</span>
        </div>
        <p className="hint">当前任务下共有 {totalOtherCount} 条“其他”，分布在 {totalOtherBatchCount} 个批次中。它们表示当前类别表还无法稳定覆盖的{analysisFocusLabel}信号。</p>
        {(latestTaskIterateExtractRun || latestTaskIterateClusterRun || latestTaskIterateClassifyRun) ? (
          <div className="progressPanel">
            <div className="progressBar">
              <div
                className={`progressValue ${iterateFlowActive ? "progressActive" : ""} ${iterateClusterActive && !latestTaskIterateClassifyRun ? "progressIndeterminate" : ""}`}
                style={{ width: `${iterateProgress}%` }}
              />
            </div>
            <p className="progressCopy">{iterateStatusText}</p>
          </div>
        ) : null}
        <div className="taskStats">
          {currentTaskIterateRound !== null ? <span>当前轮次 #{currentTaskIterateRound}</span> : <span>当前轮次尚未开始</span>}
          <span>提取 {formatRunStatus(latestTaskIterateExtractRun?.status)}</span>
          <span>聚类 {iterateClusterActive ? "进行中" : formatRunStatus(latestTaskIterateClusterRun?.status)}</span>
          <span>重分 {iterateClassifyActive ? "进行中" : formatRunStatus(latestTaskIterateClassifyRun?.status)}</span>
          {latestTaskIterateClassifyRun?.finishedAt ? (
            <span>{formatTime(latestTaskIterateClassifyRun.finishedAt)}</span>
          ) : latestTaskIterateClusterRun?.finishedAt ? (
            <span>{formatTime(latestTaskIterateClusterRun.finishedAt)}</span>
          ) : latestTaskIterateExtractRun?.finishedAt ? (
            <span>{formatTime(latestTaskIterateExtractRun.finishedAt)}</span>
          ) : null}
        </div>
        <AsyncStepButton
          endpoint={`/api/tasks/${taskId}/iterate`}
          label="开始处理全部其他"
          disabled={!totalOtherCount || iterateFlowActive || batchRunsActive}
          disabledReason={
            batchRunsActive
              ? "当前有批次级任务正在运行，请等待完成后再处理全部其他。"
              : iterateFlowActive
                ? "当前正在处理全部其他，请等待当前轮次完成后再启动新一轮。"
              : !totalOtherCount
                ? "当前任务没有“其他”记录可处理。"
                : undefined
          }
        />
      </article>

      <article className="panel workspaceSectionPanel convergenceActionPanel">
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">Category Consolidation</p>
            <h2>合并近似类别</h2>
          </div>
        </div>
        {mergeError ? <p className="logError">{mergeError}</p> : null}
        <form action={generateCategoryMergeSuggestionsAction} className="stack compactStack">
          <input type="hidden" name="taskId" value={taskId} />
          <label className="field">
            <span>最大合并后类别数</span>
            <input
              name="maxTargetCount"
              type="number"
              min={1}
              max={Math.max(activeCategoryCount, 1)}
              defaultValue={Math.max(Math.min(activeCategoryCount, 5), 1)}
              required
            />
          </label>
          <PendingSubmitButton
            idleLabel="合并近似类别"
            pendingLabel="合并近似类别中"
            className="secondaryButton"
            disabled={activeCategoryCount < 2 || hasActiveRuns}
          />
        </form>

        {latestMergeRun ? (
          <div className="stack compactStack">
            <p className="hint">
              最近一轮合并建议：{latestMergeRun.status}
              {latestMergeRun.finishedAt ? ` · ${formatTime(latestMergeRun.finishedAt)}` : ""}
            </p>
            {mergeSuggestions.length ? (
              <>
                {mergeSuggestions.map((suggestion) => {
                  const sourceNames = JSON.parse(suggestion.sourceCategoryNamesJson) as string[];

                  return (
                    <article key={suggestion.id} className="resultCard">
                      <div className="taskCardHeader">
                        <div>
                          <h3>{suggestion.suggestedName}</h3>
                          <p>{suggestion.suggestedDefinition}</p>
                        </div>
                        <span className="badge">{sourceNames.length} 合 1</span>
                      </div>
                      <p className="quoteBlock">来源类别：{sourceNames.join("、")}</p>
                    </article>
                  );
                })}
                <div className="actionRow">
                  <form action={applyCategoryMergeSuggestionsAction}>
                    <input type="hidden" name="taskId" value={taskId} />
                    <input type="hidden" name="mergeRunId" value={latestMergeRun.id} />
                    <button type="submit" className="primaryButton" disabled={hasActiveRuns}>
                      确认应用合并结果
                    </button>
                  </form>
                  <form action={discardCategoryMergeSuggestionsAction}>
                    <input type="hidden" name="taskId" value={taskId} />
                    <input type="hidden" name="mergeRunId" value={latestMergeRun.id} />
                    <button type="submit" className="ghostButton" disabled={hasActiveRuns}>
                      丢弃建议
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <p className="hint">当前没有待确认的类别合并建议。</p>
            )}
          </div>
        ) : null}
      </article>

      <article className="panel workspaceSectionPanel workspaceResultPanel">
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">Current Result</p>
            <h2>当前任务分析结果</h2>
          </div>
          <ExportCsvButton href={`/tasks/${taskId}/export`} />
        </div>
        <div className="taskStats">
          <span>已归档任务批次：{batchesCount} 个</span>
          <span>已生成分析结果：{mergedTotal} 条</span>
          <span>任务目标：{analysisGoal}</span>
          <span>汇总展示包含 0 命中类别；CSV 明细导出只包含实际对话结果</span>
        </div>
        {mergedCategorySummary.length ? (
          <div className="stack">
            {mergedTotal ? (
              <div className="summaryChartCard">
                <div className="summaryChartGraphic">
                  <svg viewBox="0 0 520 440" className="summaryChartSvg summaryChartSvgDetailed" aria-label="类别占比饼图">
                    <g transform="rotate(-90 260 220)">
                      <circle cx="260" cy="220" r="128" className="summaryChartTrack" />
                      {chartSegments.map((segment) => (
                        <circle
                          key={`chart-${segment.categoryName}`}
                          cx="260"
                          cy="220"
                          r="128"
                          className="summaryChartSegment"
                          style={{
                            stroke: segment.color,
                            strokeDasharray: `${segment.segmentLength} ${chartCircumference - segment.segmentLength}`,
                            strokeDashoffset: segment.segmentOffset,
                          }}
                        />
                      ))}
                    </g>
                    {chartCallouts.map((callout) => (
                      <g key={`callout-${callout.categoryName}`} className="summaryChartCalloutGroup">
                        <circle cx={callout.startX} cy={callout.startY} r="3.5" fill={callout.color} />
                        <path
                          d={`M ${callout.startX} ${callout.startY} L ${callout.midX} ${callout.midY} L ${callout.endX} ${callout.midY}`}
                          className="summaryChartConnector"
                          style={{ stroke: callout.color }}
                        />
                        <circle cx={callout.endX} cy={callout.midY} r="3" fill={callout.color} />
                        <text
                          x={callout.textX}
                          y={callout.textY - 8}
                          textAnchor={callout.anchor}
                          className="summaryChartCalloutName"
                        >
                          {callout.categoryName}
                        </text>
                        <text
                          x={callout.textX}
                          y={callout.textY + 12}
                          textAnchor={callout.anchor}
                          className="summaryChartCalloutMeta"
                        >
                          {callout.count} 条 · {callout.percent}
                        </text>
                      </g>
                    ))}
                    <circle cx="260" cy="220" r="84" className="summaryChartHole" />
                    <text x="260" y="208" textAnchor="middle" className="summaryChartValue">
                      {mergedTotal}
                    </text>
                    <text x="260" y="236" textAnchor="middle" className="summaryChartLabel">
                      总记录
                    </text>
                  </svg>
                </div>
                <div className="summaryLegend summaryLegendCompact">
                  {mergedCategorySummary.map((item, index) => (
                    <div key={`legend-${item.categoryName}`} className="summaryLegendItem">
                      <span
                        className="summaryLegendSwatch"
                        style={{
                          background: item.count
                            ? summaryChartColors[index % summaryChartColors.length]
                            : "rgba(107, 114, 128, 0.22)",
                        }}
                      />
                      <div>
                        <p className="summaryLegendName">{item.categoryName}</p>
                        <p className="summaryLegendMeta">
                          {item.count} 条，占比 {formatPercent(item.count, mergedTotal)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {mergedCategorySummary.map((item) => {
              const examples = samplesByCategory.get(item.categoryName) ?? [];

              return (
                <article key={item.categoryName} className="resultCard">
                  <div className="taskCardHeader">
                    <div>
                      <h3>{item.categoryName}</h3>
                      <p>
                        {item.count} 条，占比 {formatPercent(item.count, mergedTotal)}
                      </p>
                    </div>
                    <span className="badge">{item.count}</span>
                  </div>
                  {examples.length ? (
                    <div className="stack compactStack">
                      {examples.map((example) => (
                        <p key={`${item.categoryName}-${example.sourceDialogId}`} className="quoteBlock">
                          {example.sourceDialogId}：{example.analysisSummary || "暂无分析摘要"}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="emptyState">
            <h3>还没有可汇总的数据</h3>
            <p>至少完成一次提取或分类后，这里会展示任务维度的汇总结果并支持导出。</p>
          </div>
        )}
      </article>
    </div>
  );
}
