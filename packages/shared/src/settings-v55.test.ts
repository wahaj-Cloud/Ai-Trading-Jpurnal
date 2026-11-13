import { describe, expect, it } from "vitest";
import { emailHeld, inQuietHours, notificationPrefsSchema } from "./goals.js";
import {
  appPrefsPatchSchema,
  DEFAULT_APP_PREFS,
  readAppPrefs,
  updateProfileSchema,
} from "./settings.js";

describe("quiet hours", () => {
  it("handles ranges that wrap midnight", () => {
    expect(inQuietHours(23, 22, 7)).toBe(true);
    expect(inQuietHours(3, 22, 7)).toBe(true);
    expect(inQuietHours(7, 22, 7)).toBe(false);
    expect(inQuietHours(12, 22, 7)).toBe(false);
    expect(inQuietHours(13, 12, 14)).toBe(true);
    expect(inQuietHours(14, 12, 14)).toBe(false);
  });

  const prefs = { quietHours: { start: 22, end: 7, allowRisk: true } };
  // 18:30 UTC = 23:30 in Karachi (UTC+5), 13:30 in New York (UTC−5 in November).
  const at = new Date(Date.UTC(2026, 10, 12, 18, 30));
  it("holds emails in the trader's own night", () => {
    expect(emailHeld(prefs, "SETUP_ALERT", at, "Asia/Karachi")).toBe(true);
    expect(emailHeld(prefs, "SETUP_ALERT", at, "America/New_York")).toBe(false);
  });
  it("lets risk warnings through when allowed, account emails always", () => {
    expect(emailHeld(prefs, "RISK_WARNING", at, "Asia/Karachi")).toBe(false);
    const strict = { quietHours: { start: 22, end: 7, allowRisk: false } };
    expect(emailHeld(strict, "RISK_WARNING", at, "Asia/Karachi")).toBe(true);
    expect(emailHeld(strict, "ACCOUNT", at, "Asia/Karachi")).toBe(false);
  });
  it("a pause holds until it ends", () => {
    const p = { pausedUntil: new Date(at.getTime() + 3_600_000).toISOString() };
    expect(emailHeld(p, "WEEKLY_REPORT", at, "UTC")).toBe(true);
    expect(emailHeld(p, "WEEKLY_REPORT", new Date(at.getTime() + 3_600_001), "UTC")).toBe(false);
    expect(emailHeld(p, "ACCOUNT", at, "UTC")).toBe(false);
  });
  it("older saved preferences stay valid; start and end must differ", () => {
    expect(notificationPrefsSchema.parse({ email: {}, reminderHour: 21 })).toMatchObject({
      quietHours: null,
      pausedUntil: null,
    });
    expect(notificationPrefsSchema.safeParse({ quietHours: { start: 5, end: 5 } }).success).toBe(
      false,
    );
    expect(emailHeld({ nonsense: 1 }, "SETUP_ALERT", at, "UTC")).toBe(false);
  });
});

describe("app preferences", () => {
  it("defaults, and keeps the valid part of a damaged save", () => {
    expect(readAppPrefs(undefined)).toEqual(DEFAULT_APP_PREFS);
    expect(
      readAppPrefs({ startPage: "orderflow", riskPct: 999, orderflowWindow: "7m", extra: true }),
    ).toEqual({ ...DEFAULT_APP_PREFS, startPage: "orderflow" });
  });
  it("patches are partial and checked", () => {
    expect(appPrefsPatchSchema.parse({ riskPct: 0.5 })).toEqual({ riskPct: 0.5 });
    expect(appPrefsPatchSchema.safeParse({ riskPct: 20 }).success).toBe(false);
    expect(appPrefsPatchSchema.safeParse({ accountSizeUsd: 0 }).success).toBe(false);
    expect(appPrefsPatchSchema.safeParse({ startPage: "admin" }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ appPrefs: { reduceMotion: true } }).success).toBe(true);
  });
});
