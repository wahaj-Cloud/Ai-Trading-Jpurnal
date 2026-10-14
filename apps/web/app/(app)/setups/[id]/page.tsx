import type { SetupDto } from "@atc/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SetupBuilder } from "@/features/setups/builder";
import { ApiError, apiFetch } from "@/lib/api";

export const metadata = { title: "Edit setup" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const setup = await apiFetch<SetupDto>(`/v1/setups/${id}`).catch((err: unknown) => {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  });
  return (
    <div className="mx-auto grid max-w-6xl gap-6 grid-cols-[minmax(0,1fr)]">
      <header>
        <Link href="/setups" className="text-sm text-ink-muted hover:text-ink">
          ← My Setup Alerts
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{setup.name}</h1>
      </header>
      <SetupBuilder setup={setup} />
    </div>
  );
}
