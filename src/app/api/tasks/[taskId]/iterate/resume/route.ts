import { NextResponse } from "next/server";

import { getAppSettings } from "@/lib/app-config";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resumeInterruptedIterateAllDialogs } from "@/lib/iterate-others-service";
import { getPromptSettings } from "@/lib/prompt-config";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function POST(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { taskId } = await params;

  const task = db.prepare(`SELECT id FROM tasks WHERE id = ? AND user_id = ?`).get(taskId, userId);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const settings = getAppSettings(userId);
  const promptSettingsData = getPromptSettings(userId);

  try {
    const result = await resumeInterruptedIterateAllDialogs(taskId, settings, promptSettingsData);
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
