import { after, NextResponse } from "next/server";

import { generateClusterSuggestions } from "@/lib/clustering-service";

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
        await generateClusterSuggestions(taskId, batchId);
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
