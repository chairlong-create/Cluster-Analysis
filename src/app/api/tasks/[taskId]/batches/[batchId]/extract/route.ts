import { NextResponse } from "next/server";

import { launchBackgroundTask } from "@/lib/background-task";
import { runReasonExtraction } from "@/lib/extraction-service";

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
        await runReasonExtraction(taskId, batchId);
      },
      (error) => {
        console.error("extract_reasons failed", error);
      },
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "信号提取启动失败" },
      { status: 500 },
    );
  }
}
