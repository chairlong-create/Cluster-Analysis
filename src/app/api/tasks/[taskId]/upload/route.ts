import { NextResponse } from "next/server";

import { importBatchesFromFormData } from "@/lib/import-service";

type RouteProps = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function POST(request: Request, { params }: RouteProps) {
  const { taskId } = await params;

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
