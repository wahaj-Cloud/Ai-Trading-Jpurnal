export default function Loading() {
  return (
    <div className="grid gap-6" role="status" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-56 animate-pulse rounded bg-raised" />
      <div className="h-28 animate-pulse rounded-[var(--radius-surface)] bg-panel" />
      <div className="h-64 animate-pulse rounded-[var(--radius-surface)] bg-panel" />
    </div>
  );
}
