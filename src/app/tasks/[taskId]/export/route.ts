import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { toCsv } from "@/lib/export-utils";

type RouteProps = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function GET(_: Request, { params }: RouteProps) {
  const { taskId } = await params;

  const task = db
    .prepare(`SELECT name FROM tasks WHERE id = ?`)
    .get(taskId) as { name: string } | undefined;

  if (!task) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  const rows = db
    .prepare(`
      SELECT
        b.file_name AS fileName,
        d.source_dialog_id AS sourceDialogId,
        d.source_text AS sourceText,
        COALESCE(r.buy_block_reason, '') AS analysisSummary,
        COALESCE(r.category_name_snapshot, '') AS categoryName,
        COALESCE(r.evidence_quote, '') AS evidenceQuote,
        COALESCE(r.evidence_explanation, '') AS evidenceExplanation,
        COALESCE(r.result_status, '') AS resultStatus
      FROM dialogs d
      JOIN batches b ON b.id = d.batch_id
      LEFT JOIN dialog_analysis_results r ON r.dialog_id = d.id
      WHERE d.task_id = ?
      ORDER BY b.created_at ASC, d.created_at ASC
    `)
    .all(taskId) as Array<{
    fileName: string;
    sourceDialogId: string;
    sourceText: string;
    analysisSummary: string;
    categoryName: string;
    evidenceQuote: string;
    evidenceExplanation: string;
    resultStatus: string;
  }>;

  const csv = toCsv([
    ["batch_file", "source_dialog_id", "text", "analysis_summary", "category", "evidence_quote", "evidence_explanation", "result_status"],
    ...rows.map((row) => [
      row.fileName,
      row.sourceDialogId,
      row.sourceText,
      row.analysisSummary,
      row.categoryName,
      row.evidenceQuote,
      row.evidenceExplanation,
      row.resultStatus,
    ]),
  ]);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(task.name)}-analysis.csv"`,
    },
  });
}
