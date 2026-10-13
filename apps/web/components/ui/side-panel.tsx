"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * A panel that slides in from the right over a dimmed page. Rendered into <body> so a blurred
 * (backdrop-filter) parent like the top bar cannot trap it. Escape or a click outside closes it.
 */
export function SidePanel({
  open,
  onClose,
  title,
  description,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label={`Close ${title}`}
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="pop absolute inset-y-3 right-3 flex w-[min(26rem,calc(100vw-1.5rem))] flex-col rounded-[var(--radius-surface)]"
      >
        <header className="flex items-start justify-between gap-4 p-5 pb-0 sm:p-6 sm:pb-0">
          <div>
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-ink-muted hover:bg-hi/[0.08] hover:text-ink"
          >
            <X className="h-5 w-5" aria-hidden="true" />
            <span className="sr-only">Close</span>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">{children}</div>
        {footer && <div className="border-t border-rule p-4 sm:px-6">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
