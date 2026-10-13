"use client";

import {
  DASHBOARD_WIDGETS,
  type DashboardLayout,
  type DashboardWidgetId,
  defaultLayout,
} from "@atc/shared";
import { ArrowDown, ArrowUp, Eye, EyeOff, LayoutGrid, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { SidePanel } from "@/components/ui/side-panel";
import { saveDashboardLayoutAction } from "@/features/settings/actions";
import { cn } from "@/lib/cn";

const LABELS = new Map<DashboardWidgetId, string>(DASHBOARD_WIDGETS.map((w) => [w.id, w.label]));

/** "Customize" button and panel: show, hide and reorder dashboard widgets; saved to the account. */
export function CustomizeDashboard({ layout }: { layout: DashboardLayout }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DashboardLayout>(layout);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();

  const openPanel = () => {
    setDraft(layout);
    setError(false);
    setOpen(true);
  };
  const close = useCallback(() => setOpen(false), []);

  const move = (i: number, by: -1 | 1) =>
    setDraft((d) => {
      const j = i + by;
      if (j < 0 || j >= d.length) return d;
      const next = [...d];
      [next[i], next[j]] = [next[j] as (typeof d)[number], next[i] as (typeof d)[number]];
      return next;
    });
  const toggle = (i: number) =>
    setDraft((d) => d.map((s, k) => (k === i ? { ...s, hidden: !s.hidden } : s)));

  const save = () =>
    start(async () => {
      const res = await saveDashboardLayoutAction(draft);
      if (!res.ok) return setError(true);
      setOpen(false);
      router.refresh();
    });

  const shown = draft.filter((s) => !s.hidden).length;

  return (
    <>
      <Button variant="secondary" size="sm" onClick={openPanel} aria-haspopup="dialog">
        <LayoutGrid className="h-4 w-4" aria-hidden="true" />
        Customize
      </Button>
      <SidePanel
        open={open}
        onClose={close}
        title="Customize dashboard"
        description={`Show, hide and reorder what you see. ${shown} of ${draft.length} shown. Hidden items can be switched back on any time.`}
        footer={
          <div className="grid gap-2">
            {error && (
              <p role="alert" className="text-sm text-loss">
                Your layout was not saved. Try again.
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDraft(defaultLayout())}
                disabled={pending}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Reset to default
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={close} disabled={pending}>
                  Cancel
                </Button>
                <Button size="sm" onClick={save} disabled={pending}>
                  {pending ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        }
      >
        <ol className="grid gap-1.5">
          {draft.map((slot, i) => {
            const label = LABELS.get(slot.id) ?? slot.id;
            return (
              <li
                key={slot.id}
                className={cn(
                  "flex items-center gap-2 rounded-[var(--radius-control)] border px-2.5 py-2",
                  slot.hidden ? "border-rule/60 opacity-60" : "raised",
                )}
              >
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  aria-pressed={!slot.hidden}
                  title={slot.hidden ? `Show ${label}` : `Hide ${label}`}
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
                    slot.hidden
                      ? "text-ink-faint hover:bg-hi/[0.08]"
                      : "text-coach hover:bg-hi/[0.08]",
                  )}
                >
                  {slot.hidden ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span className="sr-only">{slot.hidden ? `Show ${label}` : `Hide ${label}`}</span>
                </button>
                <span className={cn("flex-1 text-sm", slot.hidden && "line-through")}>{label}</span>
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="rounded-full p-1.5 text-ink-muted hover:bg-hi/[0.08] hover:text-ink disabled:opacity-30"
                >
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Move {label} up</span>
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === draft.length - 1}
                  className="rounded-full p-1.5 text-ink-muted hover:bg-hi/[0.08] hover:text-ink disabled:opacity-30"
                >
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Move {label} down</span>
                </button>
              </li>
            );
          })}
        </ol>
      </SidePanel>
    </>
  );
}
