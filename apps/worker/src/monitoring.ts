/**
 * Error monitoring (sentry.io), off unless SENTRY_DSN is set. Only unexpected errors are sent, with
 * no request bodies, headers or user data: exchange keys and trading data never leave our systems.
 */
type Sentry = typeof import("@sentry/node");
let sentry: Sentry | null = null;

export async function initMonitoring(
  dsn: string | undefined,
  environment: string,
  service: string,
): Promise<void> {
  if (!dsn) return;
  sentry = await import("@sentry/node");
  sentry.init({
    dsn,
    environment,
    initialScope: { tags: { service } },
    // Collect nothing about users or requests (keys, tokens and trades must never leave).
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [] },
    tracesSampleRate: 0,
    // Outgoing-request breadcrumbs carry exchange URLs with signed query strings: never send them.
    beforeBreadcrumb(crumb) {
      return crumb.category === "http" || crumb.category === "fetch" ? null : crumb;
    },
    beforeSend(event) {
      delete event.request;
      delete event.user;
      return event;
    },
  });
}

export function captureError(
  err: unknown,
  context: Record<string, string | number | undefined> = {},
): void {
  if (!sentry) return;
  sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(context)) if (v !== undefined) scope.setTag(k, String(v));
    sentry?.captureException(err);
  });
}
