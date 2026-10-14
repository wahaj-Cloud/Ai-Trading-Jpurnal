import Link from "next/link";
import { SetupBuilder } from "@/features/setups/builder";

export const metadata = { title: "New setup" };

export default function NewSetupPage() {
  return (
    <div className="mx-auto grid max-w-6xl gap-6 grid-cols-[minmax(0,1fr)]">
      <header>
        <Link href="/setups" className="text-sm text-ink-muted hover:text-ink">
          ← My Setup Alerts
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">New setup</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Build the setup you already trade from simple conditions, preview where it would have
          fired, then save it to get alerts.
        </p>
      </header>
      <SetupBuilder />
    </div>
  );
}
