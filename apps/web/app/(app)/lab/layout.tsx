import type { ReactNode } from "react";
import { LabTabs } from "@/features/labs/lab-tabs";

export default function LabLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-7xl gap-6 grid-cols-[minmax(0,1fr)]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lab</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Test ideas before you risk money: replay your own trades with better rules, run your
            saved setups over past candles, or let a paper bot trade them live with virtual money.
          </p>
        </div>
        <LabTabs />
      </header>
      {children}
    </div>
  );
}
