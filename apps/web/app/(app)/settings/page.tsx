import { listCurrencies, listTimezones, type NotificationPrefs } from "@atc/shared";
import Link from "next/link";
import { FoundingBadge } from "@/features/billing/founding-badge";
import { NotificationPrefsForm } from "@/features/settings/notification-prefs";
import { ProfileForm } from "@/features/settings/profile-form";
import { apiFetch } from "@/lib/api";
import { getDisplay } from "@/lib/display";
import { getMe } from "@/lib/me";

export const metadata = { title: "Settings" };

function namedCurrencies(): Array<{ code: string; name: string }> {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(["en"], { type: "currency" });
  } catch {
    names = null;
  }
  return listCurrencies().map((code) => ({ code, name: names?.of(code) ?? code }));
}

export default async function SettingsPage() {
  const [me, prefs, display] = await Promise.all([
    getMe(),
    apiFetch<NotificationPrefs>("/v1/notification-preferences"),
    getDisplay(),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-ink-muted">
        You are on the {me.plan.name} plan.{" "}
        {me.foundingMember && (
          <>
            <FoundingBadge />{" "}
          </>
        )}
        <Link href="/billing" className="text-ink underline underline-offset-4">
          Plan and billing
        </Link>
      </p>
      <div className="mt-8 rounded-[var(--radius-surface)] surface p-5 sm:p-8">
        <ProfileForm
          me={me}
          timezones={listTimezones()}
          currencies={namedCurrencies()}
          display={display}
        />
      </div>
      <section
        id="notifications"
        aria-labelledby="notifications-heading"
        className="mt-6 scroll-mt-20 rounded-[var(--radius-surface)] surface p-5 sm:p-8"
      >
        <h2 id="notifications-heading" className="mb-5 font-semibold">
          Notifications
        </h2>
        <NotificationPrefsForm prefs={prefs} />
      </section>
    </div>
  );
}
