"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

type TaskIterateResumeProps = {
  resumeUrl: string;
  shouldResume: boolean;
};

export function TaskIterateResume({ resumeUrl, shouldResume }: TaskIterateResumeProps) {
  const router = useRouter();
  const retryCountRef = useRef(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    retryCountRef.current = 0;
    inFlightRef.current = false;
  }, [resumeUrl]);

  useEffect(() => {
    if (!shouldResume) {
      retryCountRef.current = 0;
      inFlightRef.current = false;
      return;
    }

    let cancelled = false;
    let retryTimer: number | undefined;
    let refreshTimer: number | undefined;

    const attemptResume = () => {
      if (cancelled || inFlightRef.current || retryCountRef.current >= 3) {
        return;
      }

      inFlightRef.current = true;
      retryCountRef.current += 1;

      void fetch(resumeUrl, {
        method: "POST",
        cache: "no-store",
      }).finally(() => {
        inFlightRef.current = false;

        if (cancelled) {
          return;
        }

        refreshTimer = window.setTimeout(() => {
          router.refresh();
        }, 400);

        if (retryCountRef.current < 3) {
          retryTimer = window.setTimeout(attemptResume, 5000);
        }
      });
    };

    attemptResume();

    return () => {
      cancelled = true;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
      if (refreshTimer) {
        window.clearTimeout(refreshTimer);
      }
    };
  }, [resumeUrl, router, shouldResume]);

  return null;
}
