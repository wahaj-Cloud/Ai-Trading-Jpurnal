import { listCurrencies, listTimezones, type NotificationPrefs } from "@atc/shared";
import Link from "next/link";
import { FoundingBadge } from "@/features/billing/founding-badge";
import { AppPrefsForm } from "@/features/settings/app-prefs-form";
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
      <nav aria-label="Settings sections" className="mt-6 flex flex-wrap gap-2 text-sm">
        {[
          ["#profile", "Profile"],
          ["#app", "App & trading"],
          ["#notifications", "Notifications"],
          ["#data", "Your data"],
        ].map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="rounded-full border border-rule px-3 py-1 text-ink-muted hover:bg-hi/[0.06] hover:text-ink"
          >
            {label}
          </a>
        ))}
      </nav>
      <div
        id="profile"
        className="mt-6 scroll-mt-20 rounded-[var(--radius-surface)] surface p-5 sm:p-8"
      >
        <ProfileForm
          me={me}
          timezones={listTimezones()}
          currencies={namedCurrencies()}
          display={display}
        />
      </div>
      <section
        id="app"
        aria-labelledby="app-heading"
        className="mt-6 scroll-mt-20 rounded-[var(--radius-surface)] surface p-5 sm:p-8"
      >
        <h2 id="app-heading" className="sr-only">
          App and trading preferences
        </h2>
        <AppPrefsForm prefs={me.settings.appPrefs} />
      </section>
      <section
        id="notifications"
        aria-labelledby="notifications-heading"
        className="mt-6 scroll-mt-20 rounded-[var(--radius-surface)] surface p-5 sm:p-8"
      >
        <h2 id="notifications-heading" className="mb-5 font-semibold">
          Notifications
        </h2>
        <NotificationPrefsForm prefs={prefs} timeZone={me.timezone} />
      </section>
      <section
        id="data"
        aria-labelledby="data-heading"
        className="mt-6 scroll-mt-20 rounded-[var(--radius-surface)] surface p-5 sm:p-8"
      >
        <h2 id="data-heading" className="font-semibold">
          Your data
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          Download everything you keep in WickMentor as one file: trades, journal, AI reviews and
          notes, coach chats, goals, setups, alerts and paper bots. Exchange keys are never
          included.
        </p>
        <a
          href="/settings/export"
          download
          className="mt-4 inline-flex items-center rounded-full border border-rule px-4 py-2 text-sm hover:bg-hi/[0.06]"
        >
          Download my data (JSON)
        </a>
        <p className="mt-4 text-xs text-ink-faint">
          Spreadsheets of your trades are in{" "}
          <Link href="/reports" className="underline underline-offset-2 hover:text-ink">
            Reports
          </Link>
          . To close your account, open your profile picture menu, choose Manage account, then
          Delete account: your data and exchange keys are removed.
        </p>
      </section>
    </div>
  );
}
