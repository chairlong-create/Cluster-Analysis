"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

type TaskIterateResumeProps = {
  resumeUrl: string;
  shouldResume: boolean;
};

export function TaskIterateResume({ resumeUrl, shouldResume }: TaskIterateResumeProps) {
  const router = useRouter();
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!shouldResume || attemptedRef.current) {
      return;
    }

    attemptedRef.current = true;

    void fetch(resumeUrl, {
      method: "POST",
      cache: "no-store",
    }).finally(() => {
      window.setTimeout(() => {
        router.refresh();
      }, 400);
    });
  }, [resumeUrl, router, shouldResume]);

  useEffect(() => {
    if (!shouldResume) {
      attemptedRef.current = false;
    }
  }, [shouldResume]);

  return null;
}
