import { after, NextResponse } from "next/server";

import { iterateAllOtherDialogs } from "@/lib/iterate-others-service";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function POST(_request: Request, { params }: RouteContext) {
  const { taskId } = await params;

  try {
    after(async () => {
      try {
        await iterateAllOtherDialogs(taskId);
      } catch (error) {
        console.error("iterate_all_others failed", error);
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "处理全部其他启动失败" },
      { status: 500 },
    );
  }
}
