"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { type ImportState, importCsvAction } from "./import-action";

const initial: ImportState = { status: "idle" };

export function ImportForm() {
  const [state, action, pending] = useActionState(importCsvAction, initial);
  return (
    <form action={action} className="grid gap-5">
      <div className="grid gap-1.5">
        <label htmlFor="file" className="text-sm font-medium">
          CSV file
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          className="block w-full text-sm text-ink-muted file:mr-4 file:h-10 file:cursor-pointer file:rounded-[var(--radius-control)] file:border file:border-rule file:bg-raised file:px-4 file:text-sm file:text-ink"
        />
        <p className="text-sm text-ink-muted">Up to 1 MB, about 5,000 trades.</p>
      </div>

      {state.status === "error" && (
        <div
          role="alert"
          className="rounded-[var(--radius-control)] border border-loss/40 bg-loss/10 p-4 text-sm"
        >
          <p>{state.message}</p>
          {state.errors && (
            <ul className="mt-2 grid gap-1 text-ink-muted">
              {state.errors.map((e) => (
                <li key={e.line}>
                  <span className="figures text-ink">Line {e.line}</span>: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {state.status === "done" && state.result && (
        <div
          role="status"
          className="rounded-[var(--radius-control)] border border-rule bg-raised p-4 text-sm"
        >
          <p>
            Imported {state.result.imported} new trade{state.result.imported === 1 ? "" : "s"}
            {state.result.updated > 0 ? `, updated ${state.result.updated}` : ""}.
          </p>
          {state.result.skippedAlreadySynced > 0 && (
            <p className="mt-1 text-ink-muted">
              Skipped {state.result.skippedAlreadySynced} already covered by your connected
              exchanges, so nothing is counted twice.
            </p>
          )}
          <Link
            href="/trades"
            className="mt-2 inline-block text-ink underline decoration-rule underline-offset-4"
          >
            View trades
          </Link>
        </div>
      )}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Importing…" : "Import trades"}
        </Button>
      </div>
    </form>
  );
}
