import Link from "next/link";

type TaskOverviewHeaderProps = {
  taskId: string;
  selectedBatchId?: string | null;
  taskName: string;
  taskDescription: string | null;
  analysisGoal: string;
  llmProvider: string;
  batchCount: number;
  dialogCount: number;
  activeCategoryCount: number;
  otherCount: number;
  nextActionLabel: string;
  nextActionTab: "batches" | "convergence";
};

export function TaskOverviewHeader({
  taskId,
  selectedBatchId,
  taskName,
  taskDescription,
  analysisGoal,
  llmProvider,
  batchCount,
  dialogCount,
  activeCategoryCount,
  otherCount,
  nextActionLabel,
  nextActionTab,
}: TaskOverviewHeaderProps) {
  const nextActionHref = selectedBatchId
    ? `/tasks/${taskId}?tab=${nextActionTab}&batchId=${selectedBatchId}`
    : `/tasks/${taskId}?tab=${nextActionTab}`;

  return (
    <header className="workspaceHeader workspaceHeroHeader">
      <div className="workspaceHeroMain">
        <div className="workspaceHeroTopline">
          <Link href="/" className="backLink">
            返回任务列表
          </Link>
          <p className="eyebrow">Task Workspace</p>
        </div>
        <div className="workspaceHeroTitleBlock">
          <h1>{taskName}</h1>
          <p className="heroCopy">
            {taskDescription || `这是一套围绕“${analysisGoal}”持续演进的分析类别体系。`}
          </p>
        </div>
      </div>
      <div className="workspaceHeroSide">
        <div className="workspaceMeta">
          <Link
            href={selectedBatchId ? `/tasks/${taskId}/logs?batchId=${selectedBatchId}` : `/tasks/${taskId}/logs`}
            className="badge"
            scroll={false}
          >
            查看日志
          </Link>
          <span className="badge">LLM: {llmProvider}</span>
        </div>
        <div className="workspaceOverviewGrid">
          <div className="overviewStat">
            <span className="overviewLabel">总批次</span>
            <strong>{batchCount}</strong>
          </div>
          <div className="overviewStat">
            <span className="overviewLabel">总对话</span>
            <strong>{dialogCount}</strong>
          </div>
          <div className="overviewStat">
            <span className="overviewLabel">活跃类别</span>
            <strong>{activeCategoryCount}</strong>
          </div>
          <div className="overviewStat">
            <span className="overviewLabel">当前其他</span>
            <strong>{otherCount}</strong>
          </div>
        </div>
        <Link href={nextActionHref} className="nextActionCard" scroll={false}>
          <span className="overviewLabel">当前推荐下一步</span>
          <strong>{nextActionLabel}</strong>
          <span className="nextActionHint">进入当前最优先的工作面板</span>
        </Link>
      </div>
    </header>
  );
}
