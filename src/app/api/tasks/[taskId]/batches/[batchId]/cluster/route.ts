import { after, NextResponse } from "next/server";

import { getAppSettings } from "@/lib/app-config";
import { auth } from "@/lib/auth";
import { generateClusterSuggestions } from "@/lib/clustering-service";
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
    after(async () => {
      try {
        await generateClusterSuggestions(taskId, batchId, "cluster_reasons", undefined, settings, promptSettingsData);
      } catch (error) {
        console.error("cluster_reasons failed", error);
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "聚类建议生成失败" },
      { status: 500 },
    );
  }
}
