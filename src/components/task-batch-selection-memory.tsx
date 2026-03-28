"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type TaskBatchSelectionMemoryProps = {
  taskId: string;
  selectedBatchId?: string | null;
  activeTab: "batches" | "convergence";
};

function getStorageKey(taskId: string) {
  return `task-workspace:selected-batch:${taskId}`;
}

export function TaskBatchSelectionMemory({
  taskId,
  selectedBatchId,
  activeTab,
}: TaskBatchSelectionMemoryProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!selectedBatchId) {
      return;
    }

    window.localStorage.setItem(getStorageKey(taskId), selectedBatchId);
  }, [selectedBatchId, taskId]);

  useEffect(() => {
    if (selectedBatchId) {
      return;
    }

    const rememberedBatchId = window.localStorage.getItem(getStorageKey(taskId));
    if (!rememberedBatchId) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", activeTab);
    params.set("batchId", rememberedBatchId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [activeTab, pathname, router, searchParams, selectedBatchId, taskId]);

  return null;
}
