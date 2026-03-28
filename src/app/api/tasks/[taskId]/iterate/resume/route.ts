import { NextResponse } from "next/server";

import { resumeInterruptedIterateAllDialogs } from "@/lib/iterate-others-service";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function POST(_request: Request, { params }: RouteContext) {
  const { taskId } = await params;

  try {
    const result = await resumeInterruptedIterateAllDialogs(taskId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "处理全部其他续跑失败",
      },
      { status: 500 },
    );
  }
}
