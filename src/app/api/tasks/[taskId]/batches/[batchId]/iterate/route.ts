import { after, NextResponse } from "next/server";

import { iterateOtherDialogs } from "@/lib/iterate-others-service";

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
        await iterateOtherDialogs(taskId, batchId);
      } catch (error) {
        console.error("iterate_others failed", error);
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "处理其他启动失败" },
      { status: 500 },
    );
  }
}
