"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type AsyncStepButtonProps = {
  endpoint: string;
  label: string;
  className?: string;
  disabled?: boolean;
  disabledReason?: string;
};

export function AsyncStepButton({
  endpoint,
  label,
  className = "secondaryButton",
  disabled = false,
  disabledReason,
}: AsyncStepButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleClick() {
    if (disabled || isSubmitting || isPending) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "任务启动失败");
      }

      startTransition(() => {
        router.refresh();
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "任务启动失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="stack compactStack">
      <button type="button" className={className} disabled={disabled || isSubmitting || isPending} onClick={handleClick}>
        {isSubmitting || isPending ? "正在启动..." : label}
      </button>
      {disabled && disabledReason ? <p className="hint">{disabledReason}</p> : null}
      {error ? <p className="logError">{error}</p> : null}
    </div>
  );
}
