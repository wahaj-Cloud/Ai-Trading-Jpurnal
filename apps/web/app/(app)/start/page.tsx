import { START_PAGES } from "@atc/shared";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/me";

/** Signing in lands here, then on the trader's chosen start page (Settings → App). */
export default async function StartPage() {
  const me = await getMe();
  redirect(START_PAGES[me.settings.appPrefs.startPage]?.href ?? "/dashboard");
}
