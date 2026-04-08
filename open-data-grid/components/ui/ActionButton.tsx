import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  isLoading?: boolean;
  loadingLabel?: string;
  children: ReactNode;
}

export function ActionButton({
  children,
  className,
  disabled,
  isLoading = false,
  loadingLabel = "Working...",
  type = "button",
  ...props
}: ActionButtonProps) {
  return (
    <button
      {...props}
      className={`downloadButton${className ? ` ${className}` : ""}`}
      disabled={disabled || isLoading}
      type={type}
    >
      {isLoading ? (
        <>
          <span className="spinner" aria-hidden="true" />
          {loadingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
