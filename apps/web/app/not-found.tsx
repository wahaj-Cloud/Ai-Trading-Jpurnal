import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-32 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-ink-muted">
        The address may be mistyped, or the page has moved.
      </p>
      <ButtonLink href="/dashboard" variant="secondary" className="mt-6">
        Go to dashboard
      </ButtonLink>
    </main>
  );
}
