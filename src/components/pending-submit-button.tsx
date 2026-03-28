"use client";

import { useFormStatus } from "react-dom";

type PendingSubmitButtonProps = {
  idleLabel: string;
  pendingLabel: string;
  className?: string;
  disabled?: boolean;
};

export function PendingSubmitButton({
  idleLabel,
  pendingLabel,
  className = "secondaryButton",
  disabled = false,
}: PendingSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className={className} disabled={disabled || pending}>
      {pending ? (
        <span className="pendingButtonContent">
          <span className="buttonSpinner" aria-hidden="true" />
          <span>{pendingLabel}</span>
        </span>
      ) : (
        idleLabel
      )}
    </button>
  );
}
