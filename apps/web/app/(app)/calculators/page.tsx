import { Calculators } from "@/features/calculators/calculators";

export const metadata = { title: "Calculators" };

export default function CalculatorsPage() {
  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Calculators</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Size positions, check your edge and see how much risk your account can take. Results
          update as you type; nothing is saved.
        </p>
      </header>
      <Calculators />
    </div>
  );
}
