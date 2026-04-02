import { NextResponse } from "next/server";

import { getAppSettings } from "@/lib/app-config";
import { auth } from "@/lib/auth";
import { launchBackgroundTask } from "@/lib/background-task";
import { runBatchClassification } from "@/lib/classification-service";
import { db } from "@/lib/db";
import { getPromptSettings } from "@/lib/prompt-config";

type RouteContext = {
  params: Promise<{
    taskId: string;
    batchId: string;
  }>;
};

export async function POST(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { taskId, batchId } = await params;

  const task = db.prepare(`SELECT id FROM tasks WHERE id = ? AND user_id = ?`).get(taskId, userId);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const settings = getAppSettings(userId);
  const promptSettingsData = getPromptSettings(userId);

  try {
    launchBackgroundTask(
      async () => {
        await runBatchClassification(taskId, batchId, settings, promptSettingsData);
      },
      (error) => {
        console.error("classify failed", error);
      },
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "批量分类启动失败" },
      { status: 500 },
    );
  }
}
