"use client";

import { POPULAR_CURRENCIES } from "@atc/shared";
import { Check, Globe } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useId, useMemo, useRef, useState, useTransition } from "react";
import { setDisplayCurrencyAction } from "@/features/settings/actions";
import { cn } from "@/lib/cn";
import { useDismiss } from "./use-dismiss";

/** Globe button: switch the currency every amount is shown in. */
export function CurrencyMenu({ current }: { current: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(box, open, close);

  // Names are computed only once the menu opens (client side), so server and browser never
  // disagree about a currency's spelling.
  const names = useMemo(() => {
    if (!open) return null;
    try {
      return new Intl.DisplayNames(["en"], { type: "currency" });
    } catch {
      return null;
    }
  }, [open]);

  const pick = (code: string) => {
    if (code === current) return setOpen(false);
    setError(false);
    start(async () => {
      const res = await setDisplayCurrencyAction(code);
      if (!res.ok) return setError(true);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <div ref={box} className="relative hidden shrink-0 sm:block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        title="Currency"
        className="flex h-9 items-center gap-1.5 rounded-full px-2.5 text-ink-muted transition-colors hover:bg-hi/[0.08] hover:text-ink"
      >
        <Globe className="h-[18px] w-[18px]" aria-hidden="true" />
        <span className="font-mono text-xs">{current}</span>
      </button>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Show amounts in"
          aria-busy={pending}
          className="pop absolute top-[calc(100%+0.5rem)] right-0 z-40 w-64 rounded-[var(--radius-surface)] p-2"
        >
          <p className="px-2.5 pt-1 pb-2 text-[10px] font-medium tracking-wider text-ink-faint uppercase">
            Show amounts in
          </p>
          <div className="grid max-h-80 overflow-y-auto">
            {POPULAR_CURRENCIES.map((c) => (
              <button
                key={c}
                type="button"
                role="option"
                aria-selected={c === current}
                disabled={pending}
                onClick={() => pick(c)}
                className={cn(
                  "flex items-center gap-3 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-sm disabled:opacity-60",
                  c === current ? "bg-hi/[0.1]" : "hover:bg-hi/[0.06]",
                )}
              >
                <span className="w-10 font-mono text-xs font-semibold">{c}</span>
                <span className="flex-1 truncate text-ink-muted">{names?.of(c) ?? c}</span>
                {c === current && <Check className="h-4 w-4 text-coach" aria-hidden="true" />}
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="px-2.5 py-1 text-xs text-loss">
              Could not change the currency. Try again.
            </p>
          )}
          <div className="my-1 h-px bg-rule" />
          <Link
            href="/settings"
            onClick={close}
            className="block rounded-[var(--radius-control)] px-2.5 py-2 text-sm text-ink-muted hover:bg-hi/[0.06] hover:text-ink"
          >
            All currencies in Settings
          </Link>
        </div>
      )}
    </div>
  );
}
