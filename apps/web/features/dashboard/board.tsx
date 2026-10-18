"use client";

import {
  DASHBOARD_GROUPS,
  DASHBOARD_SIZE_LABEL,
  type DashboardLayout,
  type DashboardSlot,
  type DashboardWidgetId,
  type DashboardWidgetSize,
  defaultLayout,
  slotSize,
  WIDGET_INFO,
} from "@atc/shared";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowRight, Check, EyeOff, GripVertical, LayoutGrid, Plus, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { SidePanel } from "@/components/ui/side-panel";
import { saveDashboardLayoutAction } from "@/features/settings/actions";
import { cn } from "@/lib/cn";

export const SIZE_CLASS: Record<DashboardWidgetSize, string> = {
  full: "col-span-12",
  wide: "col-span-12 xl:col-span-8",
  narrow: "col-span-12 xl:col-span-4",
  third: "col-span-12 lg:col-span-4",
};

const label = (id: string) => WIDGET_INFO.get(id)?.label ?? id;

/**
 * Widths offered: full, two-thirds and one-third. A third keeps the widget's own flavour ("third"
 * sits three to a row from tablet width, "narrow" beside a two-thirds widget on wide screens).
 */
const sizeChoices = (id: string): DashboardWidgetSize[] => [
  "full",
  "wide",
  WIDGET_INFO.get(id)?.size === "third" ? "third" : "narrow",
];

/**
 * The dashboard grid. Normally it just shows the widgets in the trader's order. In edit mode every
 * widget can be dragged to a new place (mouse, touch or keyboard), resized or hidden, and hidden
 * widgets can be added back from the library. The layout is saved to the account, so it is the
 * same on every device.
 */
export function DashboardBoard({
  layout,
  widgets,
  header,
  notices,
}: {
  layout: DashboardLayout;
  /** Rendered widgets; null when a widget has nothing to show yet (for example no trades). */
  widgets: Partial<Record<DashboardWidgetId, ReactNode>>;
  header: ReactNode;
  notices: ReactNode;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DashboardLayout>(layout);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const slots = editing ? draft : layout;
  const visible = slots.filter((s) => !s.hidden && (editing || widgets[s.id]));

  const startEditing = () => {
    setDraft(layout);
    setError(false);
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setLibraryOpen(false);
  };
  const save = () =>
    start(async () => {
      const res = await saveDashboardLayoutAction(draft);
      if (!res.ok) return setError(true);
      setEditing(false);
      setLibraryOpen(false);
      router.refresh();
    });

  const update = useCallback(
    (id: DashboardWidgetId, patch: Partial<DashboardSlot>) =>
      setDraft((d) => d.map((s) => (s.id === id ? { ...s, ...patch } : s))),
    [],
  );
  /** Shows a hidden widget again, placed at the end of what is shown. */
  const add = (id: DashboardWidgetId) =>
    setDraft((d) => {
      const slot = d.find((s) => s.id === id);
      if (!slot) return d;
      const rest = d.filter((s) => s.id !== id);
      const lastShown = rest.reduce((at, s, i) => (s.hidden ? at : i), -1);
      rest.splice(lastShown + 1, 0, { ...slot, hidden: false });
      return rest;
    });

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setDraft((d) => {
      const from = d.findIndex((s) => s.id === active.id);
      const to = d.findIndex((s) => s.id === over.id);
      return from < 0 || to < 0 ? d : arrayMove(d, from, to);
    });
  };

  const hiddenCount = draft.filter((s) => s.hidden).length;

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        {header}
        {!editing && (
          <Button variant="secondary" size="sm" onClick={startEditing}>
            <LayoutGrid className="h-4 w-4" aria-hidden="true" />
            Customize
          </Button>
        )}
      </header>

      {editing && (
        <section
          aria-label="Edit dashboard layout"
          className="sticky top-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-surface)] border border-coach/40 bg-sheet/95 px-4 py-3 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.7)] backdrop-blur"
        >
          <p className="text-sm">
            <span className="font-medium">Editing your dashboard.</span>{" "}
            <span className="text-ink-muted">
              Drag the handle to move a widget (on a phone, press and hold), change its width, or
              hide it.
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {error && (
              <span role="alert" className="text-sm text-loss">
                Not saved. Try again.
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={() => setLibraryOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add widgets{hiddenCount > 0 ? ` (${hiddenCount})` : ""}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDraft(defaultLayout())}
              disabled={pending}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reset
            </Button>
            <Button variant="secondary" size="sm" onClick={cancel} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={pending}>
              <Check className="h-4 w-4" aria-hidden="true" />
              {pending ? "Saving…" : "Save layout"}
            </Button>
          </div>
        </section>
      )}

      {notices}

      {editing ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visible.map((s) => s.id)} strategy={rectSortingStrategy}>
            {/* No dense packing while editing: the screen order must match the saved order. */}
            <div className="grid grid-cols-12 gap-6">
              {visible.map((slot) => (
                <SortableWidget
                  key={slot.id}
                  slot={slot}
                  onSize={(size) => update(slot.id, { size })}
                  onHide={() => update(slot.id, { hidden: true })}
                >
                  {widgets[slot.id] ?? <EmptyWidget id={slot.id} />}
                </SortableWidget>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="grid grid-flow-row-dense grid-cols-12 gap-6">
          {visible.map((slot) => (
            <div key={slot.id} className={cn(SIZE_CLASS[slotSize(slot)], "[&>*]:h-full")}>
              {widgets[slot.id]}
            </div>
          ))}
        </div>
      )}

      {editing && visible.length === 0 && (
        <p className="text-center text-sm text-ink-muted">
          Everything is hidden. Use “Add widgets” to put something back.
        </p>
      )}

      <WidgetLibrary
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        draft={draft}
        onAdd={add}
        onHide={(id) => update(id, { hidden: true })}
      />
    </>
  );
}

function SortableWidget({
  slot,
  children,
  onSize,
  onHide,
}: {
  slot: DashboardSlot;
  children: ReactNode;
  onSize: (s: DashboardWidgetSize) => void;
  onHide: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: slot.id });
  const size = slotSize(slot);
  const name = label(slot.id);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        SIZE_CLASS[size],
        "relative rounded-[var(--radius-surface)] outline-2 outline-offset-4 outline-coach/50 outline-dashed",
        isDragging && "z-30 opacity-80 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.8)]",
      )}
    >
      <div className="absolute top-2 right-2 left-2 z-10 flex items-center justify-between gap-2 rounded-full border border-rule bg-sheet/95 py-1 pr-1 pl-1 shadow-lg backdrop-blur">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Move ${name}. Use the arrow keys after pressing space.`}
          className="flex h-8 min-w-0 cursor-grab touch-none items-center gap-1.5 rounded-full px-2 text-sm font-medium active:cursor-grabbing hover:bg-hi/[0.08]"
        >
          <GripVertical className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
          <span className="truncate">{name}</span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <label className="sr-only" htmlFor={`size-${slot.id}`}>
            Width of {name}
          </label>
          <select
            id={`size-${slot.id}`}
            value={size}
            onChange={(e) => onSize(e.target.value as DashboardWidgetSize)}
            title="Width on larger screens (on a phone every widget is full width)"
            className="hidden h-8 rounded-full border border-rule bg-transparent px-2 text-xs text-ink-muted md:block"
          >
            {sizeChoices(slot.id).map((s) => (
              <option key={s} value={s} className="bg-sheet">
                {DASHBOARD_SIZE_LABEL[s]} width
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onHide}
            title={`Hide ${name}`}
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-loss/15 hover:text-loss"
          >
            <EyeOff className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Hide {name}</span>
          </button>
        </div>
      </div>
      {/* The widget itself is not clickable while arranging. */}
      <div className="pointer-events-none h-full max-h-[460px] overflow-hidden rounded-[var(--radius-surface)] pt-12 select-none [&>*]:h-full">
        {children}
      </div>
    </div>
  );
}

function EmptyWidget({ id }: { id: DashboardWidgetId }) {
  const info = WIDGET_INFO.get(id);
  return (
    <div className="surface grid min-h-36 content-center gap-1 rounded-[var(--radius-surface)] p-5 text-center">
      <p className="font-medium">{info?.label}</p>
      <p className="text-sm text-ink-muted">Fills in once you have data for it.</p>
    </div>
  );
}

/** Every widget, folder by folder: add hidden ones, hide shown ones, find each one's full page. */
function WidgetLibrary({
  open,
  onClose,
  draft,
  onAdd,
  onHide,
}: {
  open: boolean;
  onClose: () => void;
  draft: DashboardLayout;
  onAdd: (id: DashboardWidgetId) => void;
  onHide: (id: DashboardWidgetId) => void;
}) {
  const hidden = useMemo(() => new Set(draft.filter((s) => s.hidden).map((s) => s.id)), [draft]);
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Widget library"
      description="Choose what belongs on your dashboard. Market widgets are short summaries; each links to its full page under Markets."
      footer={
        <div className="flex justify-end">
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="grid gap-6">
        {DASHBOARD_GROUPS.map((g) => {
          const items = draft
            .map((s) => WIDGET_INFO.get(s.id))
            .filter((w) => w?.group === g.id)
            .sort((a, b) => (a?.label ?? "").localeCompare(b?.label ?? ""));
          return (
            <section key={g.id} aria-label={g.label}>
              <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-ink-faint uppercase">
                {g.label}
              </h3>
              <ul className="grid gap-2">
                {items.map((w) => {
                  if (!w) return null;
                  const id = w.id as DashboardWidgetId;
                  const isHidden = hidden.has(id);
                  return (
                    <li
                      key={id}
                      className={cn(
                        "flex items-start gap-3 rounded-[var(--radius-control)] border p-3",
                        isHidden ? "border-rule" : "border-coach/40 bg-coach/[0.06]",
                      )}
                    >
                      <div className="grid min-w-0 flex-1 gap-0.5">
                        <p className="text-sm font-medium">{w.label}</p>
                        <p className="text-xs text-ink-muted">{w.description}</p>
                        {w.home && (
                          <Link
                            href={w.home.href}
                            className="inline-flex items-center gap-1 text-xs text-coach underline-offset-4 hover:underline"
                          >
                            Full version: {w.home.label}
                            <ArrowRight className="h-3 w-3" aria-hidden="true" />
                          </Link>
                        )}
                      </div>
                      {isHidden ? (
                        <Button size="sm" variant="secondary" onClick={() => onAdd(id)}>
                          <Plus className="h-4 w-4" aria-hidden="true" />
                          Add
                        </Button>
                      ) : (
                        <div className="grid shrink-0 justify-items-end gap-1">
                          <span className="flex items-center gap-1 text-xs text-coach">
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                            On dashboard
                          </span>
                          <Button size="sm" variant="ghost" onClick={() => onHide(id)}>
                            <EyeOff className="h-4 w-4" aria-hidden="true" />
                            Hide
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </SidePanel>
  );
}
