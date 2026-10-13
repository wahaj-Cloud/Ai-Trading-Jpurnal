import type { BucketDto } from "@atc/shared";
import { describe, expect, it } from "vitest";
import { localHour, sessionVerdict } from "./session-verdict";

const b = (key: string, trades: number, pnl: string, winRate = 0.5): BucketDto => ({
  key,
  trades,
  wins: Math.round(trades * winRate),
  losses: trades - Math.round(trades * winRate),
  winRate,
  pnl,
  avgPnl: trades ? String(Number(pnl) / trades) : null,
});
const day = new Date("2026-10-11T12:00:00Z");

describe("sessionVerdict", () => {
  it("names the most profitable and the losing session", () => {
    const v = sessionVerdict(
      [
        b("ASIA", 12, "-800"),
        b("LONDON", 9, "450"),
        b("NEW_YORK", 20, "-1500"),
        b("OFF_HOURS", 0, "0"),
      ],
      "Asia/Karachi",
      day,
    );
    expect(v.kind).toBe("ranked");
    if (v.kind !== "ranked") return;
    expect(v.best.id).toBe("LONDON");
    expect(v.worst?.id).toBe("NEW_YORK");
    expect(v.bestIsProfitable).toBe(true);
    expect(v.rows.map((r) => r.id)).toEqual(["LONDON", "ASIA", "NEW_YORK"]);
    expect(v.best.localHours).toBe("12:00–18:00");
  });

  it("does not rank sessions with too few trades", () => {
    const v = sessionVerdict([b("LONDON", 3, "900"), b("ASIA", 10, "100")], "UTC", day);
    expect(v.kind).toBe("too-few");
  });

  it("says when no session is profitable", () => {
    const v = sessionVerdict([b("LONDON", 6, "-50"), b("ASIA", 8, "-400")], "UTC", day);
    expect(v.kind === "ranked" && v.bestIsProfitable).toBe(false);
    expect(v.kind === "ranked" && v.best.id).toBe("LONDON");
  });

  it("handles no trades", () => {
    expect(sessionVerdict([], "UTC", day).kind).toBe("none");
  });

  it("falls back to UTC for an unknown timezone", () => {
    expect(localHour(7, "Not/AZone", day)).toBe("07:00");
    expect(localHour(24, "UTC", day)).toBe("00:00");
  });
});
