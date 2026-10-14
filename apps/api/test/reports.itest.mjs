// Integration test: reports and CSV / Excel / PDF exports against a real Postgres. Run after build.
import "reflect-metadata";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createPrismaClient } from "@atc/db";
import ExcelJS from "exceljs";
import { AnalyticsService } from "../dist/analytics/analytics.service.js";
import { toCsv, toPdf, toXlsx } from "../dist/reports/render.js";
import { periodBounds, ReportsService } from "../dist/reports/reports.service.js";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
const db = createPrismaClient(dbUrl);
const prisma = { client: db };
const reports = new ReportsService(prisma, new AnalyticsService(prisma));

await db.$executeRawUnsafe("TRUNCATE users CASCADE");
const mk = (n, timezone) =>
  db.user.create({
    data: {
      authProviderId: `rp${n}`,
      email: `rp${n}@x.io`,
      name: `Trader ${n}`,
      timezone,
      subscription: { create: {} },
      settings: { create: {} },
    },
  });
const alice = await mk(1, "Asia/Karachi");
const bob = await mk(2, "UTC");
const account = await db.exchangeAccount.create({
  data: { userId: alice.id, exchange: "MEXC", label: "Scalping", apiKeyHint: "abcd" },
});
let n = 0;
const pos = async (closedAt, netPnl, journal) => {
  n += 1;
  const p = await db.position.create({
    data: {
      userId: alice.id,
      accountId: account.id,
      exchange: "MEXC",
      source: "EXCHANGE",
      sourceKey: `${account.id}|X:r${n}`,
      symbol: n % 2 ? "BTCUSDT" : "ETHUSDT",
      baseAsset: n % 2 ? "BTC" : "ETH",
      quoteAsset: "USDT",
      settleAsset: "USDT",
      direction: "LONG",
      status: "CLOSED",
      openedAt: new Date(new Date(closedAt).getTime() - 3_600_000),
      closedAt: new Date(closedAt),
      entryPrice: "100",
      exitPrice: "101",
      quantity: "10",
      grossPnl: String(Number(netPnl) + 1),
      fees: "1",
      funding: "0",
      netPnl,
      holdingSeconds: 3600,
    },
  });
  if (journal)
    await db.journalEntry.create({
      data: { userId: alice.id, accountId: account.id, positionKey: p.sourceKey, ...journal },
    });
  return p;
};
// Week of Monday 14 Sept 2026 (Karachi time), plus one trade the week before.
await pos("2026-09-08T10:00:00Z", "40");
await pos("2026-09-14T06:00:00Z", "120", {
  setup: "Breakout",
  notes: '=HYPERLINK("http://evil","click")',
  tags: ["+cmd"],
  rating: 4,
  stopPrice: "95",
});
await pos("2026-09-15T06:00:00Z", "-60", { mistakes: ["MOVED_STOP"], emotions: ["FOMO"] });
await pos("2026-09-17T06:00:00Z", "35");
// 20:30 UTC on Sunday 20 Sept is 01:30 Monday 21 Sept in Karachi: next week.
await pos("2026-09-20T20:30:00Z", "999");

// 1. Period bounds and navigation.
assert.deepEqual(periodBounds("week", "2026-09-16"), {
  from: "2026-09-14",
  to: "2026-09-20",
  label: "Week of Monday, September 14, 2026",
});
assert.equal(periodBounds("month", "2026-02-11").to, "2026-02-28");
assert.deepEqual(periodBounds("year", "2026-05-01").from, "2026-01-01");
const now = new Date("2026-09-25T12:00:00Z");
const week = await reports.report(alice.id, "week", "2026-09-16", now);
assert.equal(week.analytics.summary.trades, 3, "Karachi week boundaries");
assert.equal(week.analytics.summary.netPnl, "95");
assert.equal(week.previous, "2026-09-13");
assert.equal(week.next, "2026-09-21");
assert.equal(week.bestTrades[0].netPnl, "120");
assert.equal(week.worstTrades[0].netPnl, "-60");
assert.ok(week.behaviour.flags.some((f) => f.code === "FOMO"));
const current = await reports.report(alice.id, "week", undefined, now);
assert.equal(current.next, null, "no navigation into the future");
assert.equal((await reports.report(bob.id, "week", "2026-09-16", now)).analytics.summary.trades, 0);
console.log("✓ weekly report in the trader's timezone with best/worst trades and behaviours");

// 2. CSV: every closed trade with its journal; formula injection neutralised.
// Exports use the real clock, so lift Free's 30-day history window for these fixed September trades.
await db.subscription.update({ where: { userId: alice.id }, data: { planCode: "PREMIUM" } });
const { rows } = await reports.exportRows(alice.id, { from: "2026-09-14", to: "2026-09-20" });
assert.equal(rows.length, 3);
const csv = toCsv(rows);
assert.ok(csv.startsWith("﻿Closed (your time),Closed (UTC)"));
assert.ok(
  csv.includes(`"'=HYPERLINK(""http://evil"",""click"")"`),
  "formula neutralised and quoted",
);
assert.ok(csv.includes("'+cmd"));
assert.ok(csv.includes(",-60,"), "negative numbers stay numbers");
assert.equal(rows[0].rMultiple, "2.4", "R from the journal stop: 120 ÷ (5 × 10)");
assert.equal(rows[0].closedLocal, "2026-09-14 11:00");
assert.equal((await reports.exportRows(bob.id, {})).rows.length, 0);
console.log("✓ CSV export: journal columns, local time, R multiple, formula-injection safe");

// 3. Excel: summary, daily and trades sheets with real numbers.
const buf = await toXlsx(
  await reports.reportRange(alice.id, "2026-09-14", "2026-09-20"),
  rows,
  "Trades",
);
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buf);
assert.deepEqual(
  wb.worksheets.map((w) => w.name),
  ["Summary", "Daily", "Trades"],
);
const trades = wb.getWorksheet("Trades");
assert.equal(trades.rowCount, 4);
assert.equal(trades.getRow(2).getCell(15).value, 120, "net P&L is a number");
assert.equal(trades.getRow(2).getCell(24).value, `'=HYPERLINK("http://evil","click")`);
assert.equal(wb.getWorksheet("Summary").getRow(4).getCell(2).value, 95);
console.log("✓ Excel export: summary, daily and trades sheets, numeric cells");

// 4. PDF: a valid document for each period type.
for (const period of ["day", "week", "month", "year"]) {
  const r = await reports.report(alice.id, period, "2026-09-15", now);
  const pdf = await toPdf(r, "Trader 1");
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 1500);
  if (period === "week") writeFileSync(process.env.REPORT_SAMPLE ?? "/tmp/report-sample.pdf", pdf);
}
console.log("✓ PDF reports render for day, week, month and year");

await db.$disconnect();
console.log("All reports and exports integration checks passed");
