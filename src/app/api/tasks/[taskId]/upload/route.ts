import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { importBatchesFromFormData } from "@/lib/import-service";

type RouteProps = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function POST(request: Request, { params }: RouteProps) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { taskId } = await params;

  const task = db.prepare(`SELECT id FROM tasks WHERE id = ? AND user_id = ?`).get(taskId, userId);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const formData = await request.formData();
    formData.set("taskId", taskId);
    await importBatchesFromFormData(formData);

    return NextResponse.redirect(new URL(`/tasks/${taskId}`, request.url), 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "导入失败";
    return NextResponse.redirect(
      new URL(`/tasks/${taskId}?importError=${encodeURIComponent(message)}`, request.url),
      303,
    );
  }
}
