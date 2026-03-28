import { after, NextResponse } from "next/server";

import { runBatchClassification } from "@/lib/classification-service";

type RouteContext = {
  params: Promise<{
    taskId: string;
    batchId: string;
  }>;
};

export async function POST(_request: Request, { params }: RouteContext) {
  const { taskId, batchId } = await params;

  try {
    after(async () => {
      try {
        await runBatchClassification(taskId, batchId);
      } catch (error) {
        console.error("classify failed", error);
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "批量分类启动失败" },
      { status: 500 },
    );
  }
}
