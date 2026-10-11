"use client";

import {
  EMOTION_CODES,
  EMOTIONS,
  type JournalDto,
  MAX_NOTES,
  MISTAKE_CODES,
  MISTAKES,
} from "@atc/shared";
import { Star } from "lucide-react";
import { type FormEvent, startTransition, useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { deleteJournalAction, type JournalFormState, saveJournalAction } from "./actions";

const initial: JournalFormState = { status: "idle" };
const POSITIVE = new Set(["CALM", "CONFIDENT"]);

function ChipGroup({
  name,
  legend,
  codes,
  labels,
  selected,
  isGood,
}: {
  name: string;
  legend: string;
  codes: readonly string[];
  labels: Record<string, string>;
  selected: readonly string[];
  isGood: (code: string) => boolean;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {codes.map((code) => (
          <label key={code} className="cursor-pointer">
            <input
              type="checkbox"
              name={name}
              value={code}
              defaultChecked={selected.includes(code)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "inline-block rounded-full border border-rule px-3 py-1 text-sm text-ink-muted transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-coach hover:text-ink",
                isGood(code)
                  ? "peer-checked:border-profit peer-checked:bg-profit/15 peer-checked:text-ink"
                  : "peer-checked:border-loss peer-checked:bg-loss/15 peer-checked:text-ink",
              )}
            >
              {labels[code]}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Rating({ value }: { value: number | null }) {
  const [rating, setRating] = useState(value);
  const shown = rating ?? 0;
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">How well did you execute your plan?</legend>
      <div className="flex items-center gap-1">
        <input type="hidden" name="rating" value={rating ?? ""} />
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} of 5`}
            aria-pressed={rating === n}
            onClick={() => setRating(rating === n ? null : n)}
            className="rounded p-0.5"
          >
            <Star
              className={cn("h-6 w-6", n <= shown ? "fill-coach text-coach" : "text-ink-faint")}
              aria-hidden="true"
            />
          </button>
        ))}
        <span className="ml-2 text-sm text-ink-muted">
          {["", "Poor", "Below plan", "Okay", "Good", "Textbook"][shown]}
        </span>
      </div>
    </fieldset>
  );
}

/**
 * The trader's review of one trade. Emotions and mistakes are fixed lists so they can be counted;
 * a planned stop makes the result measurable in R.
 */
export function JournalForm({
  positionId,
  journal,
  setupSuggestions,
  quoteAsset,
}: {
  positionId: string;
  journal: JournalDto | null;
  setupSuggestions: string[];
  quoteAsset: string;
}) {
  const [state, action, pending] = useActionState(
    saveJournalAction.bind(null, positionId),
    initial,
  );
  const [clearing, startClear] = useTransition();
  const [clearError, setClearError] = useState<string | null>(null);
  const err = state.fieldErrors ?? {};
  const j = journal;

  // Submitted from onSubmit rather than <form action>: React resets a form after an action, which
  // would wipe the trader's notes whenever a save is rejected. On success the page re-renders with
  // the saved entry (new key), so the form still shows exactly what was stored.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-6" key={j?.updatedAt ?? "new"}>
      <Rating value={j?.rating ?? null} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Setup"
          htmlFor="setup"
          hint="The pattern you traded, e.g. Breakout"
          error={err.setup}
        >
          <Input
            id="setup"
            name="setup"
            maxLength={80}
            defaultValue={j?.setup ?? ""}
            list="setup-suggestions"
            autoComplete="off"
          />
        </Field>
        <datalist id="setup-suggestions">
          {setupSuggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <Field
          label={`Planned stop (${quoteAsset})`}
          htmlFor="stopPrice"
          hint="Lets us measure this trade in R"
          error={err.stopPrice}
        >
          <Input
            id="stopPrice"
            name="stopPrice"
            inputMode="decimal"
            defaultValue={j?.stopPrice ?? ""}
            className="figures"
          />
        </Field>
        <Field
          label={`Planned target (${quoteAsset})`}
          htmlFor="targetPrice"
          error={err.targetPrice}
        >
          <Input
            id="targetPrice"
            name="targetPrice"
            inputMode="decimal"
            defaultValue={j?.targetPrice ?? ""}
            className="figures"
          />
        </Field>
      </div>

      <ChipGroup
        name="emotions"
        legend="What were you feeling?"
        codes={EMOTION_CODES}
        labels={EMOTIONS}
        selected={j?.emotions ?? []}
        isGood={(c) => POSITIVE.has(c)}
      />
      <ChipGroup
        name="mistakes"
        legend="Mistakes"
        codes={MISTAKE_CODES}
        labels={MISTAKES}
        selected={j?.mistakes ?? []}
        isGood={() => false}
      />

      <Field
        label="Notes"
        htmlFor="notes"
        hint="Why you entered, how you managed it, what you'd repeat"
        error={err.notes}
      >
        <textarea
          id="notes"
          name="notes"
          rows={5}
          maxLength={MAX_NOTES}
          defaultValue={j?.notes ?? ""}
          className="w-full rounded-[var(--radius-control)] border border-rule bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-coach focus:outline-none"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tags" htmlFor="tags" hint="Separate with commas, up to 10" error={err.tags}>
          <Input id="tags" name="tags" defaultValue={j?.tags.join(", ") ?? ""} />
        </Field>
        <Field
          label="Chart screenshots"
          htmlFor="screenshotUrls"
          hint="Paste https links (e.g. TradingView snapshots), one per line, up to 4"
          error={err.screenshotUrls}
        >
          <textarea
            id="screenshotUrls"
            name="screenshotUrls"
            rows={2}
            defaultValue={j?.screenshotUrls.join("\n") ?? ""}
            className="w-full rounded-[var(--radius-control)] border border-rule bg-canvas px-3 py-2 text-sm text-ink focus:border-coach focus:outline-none"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save review"}
        </Button>
        {j && (
          <Button
            type="button"
            variant="ghost"
            disabled={clearing}
            onClick={() =>
              startClear(async () => {
                const res = await deleteJournalAction(positionId);
                setClearError(res.error ?? null);
              })
            }
          >
            {clearing ? "Clearing…" : "Clear review"}
          </Button>
        )}
        <p
          role={state.status === "error" || clearError ? "alert" : "status"}
          className={cn(
            "text-sm",
            state.status === "error" || clearError ? "text-loss" : "text-ink-muted",
          )}
        >
          {clearError ?? state.message}
        </p>
      </div>
    </form>
  );
}
