import Link from "next/link";

type TaskWorkspaceTabsProps = {
  taskId: string;
  activeTab: "batches" | "convergence";
  selectedBatchId?: string | null;
};

export function TaskWorkspaceTabs({ taskId, activeTab, selectedBatchId }: TaskWorkspaceTabsProps) {
  const batchHref = selectedBatchId
    ? `/tasks/${taskId}?tab=batches&batchId=${selectedBatchId}`
    : `/tasks/${taskId}?tab=batches`;
  const convergenceHref = selectedBatchId
    ? `/tasks/${taskId}?tab=convergence&batchId=${selectedBatchId}`
    : `/tasks/${taskId}?tab=convergence`;

  return (
    <nav className="workspaceTabs" aria-label="任务工作区视图切换">
      <Link
        href={batchHref}
        className={`workspaceTab ${activeTab === "batches" ? "workspaceTabActive" : ""}`}
        scroll={false}
      >
        批次推进
      </Link>
      <Link
        href={convergenceHref}
        className={`workspaceTab ${activeTab === "convergence" ? "workspaceTabActive" : ""}`}
        scroll={false}
      >
        任务收敛
      </Link>
    </nav>
  );
}
