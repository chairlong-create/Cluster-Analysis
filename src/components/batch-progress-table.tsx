"use client";

import { useRouter } from "next/navigation";

import type { BatchSummary } from "@/components/task-workspace-types";

type BatchProgressRow = {
  batch: BatchSummary;
  workflowModeLabel: string;
  extractLabel: string;
  clusterLabel: string;
  classifyLabel: string;
  otherCount: number;
  updatedAtLabel: string;
  primaryActionLabel: string;
  selected: boolean;
};

type BatchProgressTableProps = {
  taskId: string;
  rows: BatchProgressRow[];
};

export function BatchProgressTable({ taskId, rows }: BatchProgressTableProps) {
  const router = useRouter();

  if (!rows.length) {
    return (
      <div className="emptyState">
        <h3>还没有批次</h3>
        <p>先导入一个 CSV 批次，再开始推进分析流程。</p>
      </div>
    );
  }

  return (
    <div className="panel workspaceSectionPanel batchFlowPanel">
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">Batch Flow</p>
          <h2>批次推进</h2>
        </div>
        <span className="badge">{rows.length} 个批次</span>
      </div>
      <p className="hint sectionLead">以批次为中心查看流程状态，并根据“建类 / 直接分类”用途推进下一步。</p>
      <div className="tableWrap workflowTableWrap">
        <table className="dataTable workflowTable">
          <thead>
            <tr>
              <th>批次</th>
              <th>用途</th>
              <th>导入</th>
              <th>信号提取</th>
              <th>聚类建议</th>
              <th>分类</th>
              <th>其他数</th>
              <th>最近更新</th>
              <th>下一步</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = `/tasks/${taskId}?tab=batches&batchId=${row.batch.id}`;

              return (
                <tr
                  key={row.batch.id}
                  className={[
                    "workflowTableRowInteractive",
                    row.selected ? "workflowTableRowActive" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  role="link"
                  tabIndex={0}
                  aria-current={row.selected ? "page" : undefined}
                  onClick={() => router.push(href, { scroll: false })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      router.push(href, { scroll: false });
                    }
                  }}
                >
                  <td>
                    <div className="workflowTableLink">
                      <strong>{row.batch.fileName}</strong>
                      <span>{row.batch.importedCount} 条导入</span>
                    </div>
                  </td>
                  <td>{row.workflowModeLabel}</td>
                  <td>已导入</td>
                  <td>{row.extractLabel}</td>
                  <td>{row.clusterLabel}</td>
                  <td>{row.classifyLabel}</td>
                  <td>{row.otherCount}</td>
                  <td>{row.updatedAtLabel}</td>
                  <td>{row.primaryActionLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
