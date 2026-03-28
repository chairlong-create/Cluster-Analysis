"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

type TaskLiveRefreshProps = {
  active: boolean;
  intervalMs?: number;
};

export function TaskLiveRefresh({ active, intervalMs = 2000 }: TaskLiveRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    if (!active) {
      return;
    }

    const timer = window.setInterval(() => {
      router.refresh();
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [active, intervalMs, router]);

  return null;
}
