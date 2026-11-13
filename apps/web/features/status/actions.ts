"use server";

import type { ServiceStatusDto } from "@atc/shared";
import { serverEnv } from "@/lib/env";

/** Public service status for the error page. Null when the API itself cannot be reached. */
export async function getServiceStatusAction(): Promise<ServiceStatusDto | null> {
  try {
    const res = await fetch(`${serverEnv().API_URL}/health/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as ServiceStatusDto;
  } catch {
    return null;
  }
}
