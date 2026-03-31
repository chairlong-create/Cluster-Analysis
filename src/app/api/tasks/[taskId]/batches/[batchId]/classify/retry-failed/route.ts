import { NextResponse } from "next/server";

import { launchBackgroundTask } from "@/lib/background-task";
import { retryFailedBatchClassification } from "@/lib/classification-service";

type RouteContext = {
  params: Promise<{
    taskId: string;
    batchId: string;
  }>;
};

export async function POST(_request: Request, { params }: RouteContext) {
  const { taskId, batchId } = await params;

  try {
    launchBackgroundTask(
      async () => {
        await retryFailedBatchClassification(taskId, batchId);
      },
      (error) => {
        console.error("classify_retry failed", error);
      },
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "失败分类条目重试启动失败" },
      { status: 500 },
    );
  }
}
