import type { ReportDto } from "@atc/shared";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { ExportRow } from "./reports.service.js";

export const COLUMNS: { key: keyof ExportRow; header: string; numeric?: boolean }[] = [
  { key: "closedLocal", header: "Closed (your time)" },
  { key: "closedAtUtc", header: "Closed (UTC)" },
  { key: "openedAtUtc", header: "Opened (UTC)" },
  { key: "exchange", header: "Exchange" },
  { key: "account", header: "Account" },
  { key: "symbol", header: "Symbol" },
  { key: "direction", header: "Direction" },
  { key: "quantity", header: "Size", numeric: true },
  { key: "entryPrice", header: "Entry", numeric: true },
  { key: "exitPrice", header: "Exit", numeric: true },
  { key: "leverage", header: "Leverage", numeric: true },
  { key: "grossPnl", header: "Gross P&L", numeric: true },
  { key: "fees", header: "Fees", numeric: true },
  { key: "funding", header: "Funding", numeric: true },
  { key: "netPnl", header: "Net P&L", numeric: true },
  { key: "settleAsset", header: "P&L currency" },
  { key: "holdingMinutes", header: "Held (minutes)", numeric: true },
  { key: "rMultiple", header: "R multiple", numeric: true },
  { key: "setup", header: "Setup" },
  { key: "rating", header: "Rating", numeric: true },
  { key: "emotions", header: "Emotions" },
  { key: "mistakes", header: "Mistakes" },
  { key: "tags", header: "Tags" },
  { key: "notes", header: "Notes" },
];

/**
 * Spreadsheet apps execute cells that start with = + - @ (or tab/CR) as formulas: text written by
 * users is neutralised with a leading apostrophe (OWASP CSV injection guidance).
 */
export function safeText(v: string): string {
  // Leading whitespace and full-width forms (＝＋－＠) are also read as formulas by some apps.
  return /^[\s\u3000]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20\t\r]/.test(v) ? `'${v}` : v;
}

function csvCell(v: string, numeric: boolean): string {
  const text = numeric ? v : safeText(v);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows: ExportRow[]): string {
  const lines = [COLUMNS.map((c) => c.header).join(",")];
  for (const r of rows)
    lines.push(COLUMNS.map((c) => csvCell(r[c.key], Boolean(c.numeric))).join(","));
  // BOM so Excel opens UTF-8 (symbols, names) correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}

const num = (v: string) => (v === "" ? null : Number(v));

export async function toXlsx(
  report: ReportDto | null,
  rows: ExportRow[],
  title: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "AI Trading Coach";
  wb.created = new Date();

  if (report) {
    const s = report.analytics.summary;
    const summary = wb.addWorksheet("Summary");
    summary.columns = [
      { header: "Metric", key: "k", width: 28 },
      { header: "Value", key: "v", width: 18 },
    ];
    const add = (k: string, v: string | number | null) => summary.addRow({ k, v: v ?? "" });
    add("Period", `${report.label} (${report.from} to ${report.to})`);
    add("Trades", s.trades);
    add("Net P&L (USD)", num(s.netPnl));
    add("Win rate", s.winRate);
    add("Profit factor", s.profitFactor);
    add("Expectancy (USD per trade)", s.expectancy ? num(s.expectancy) : null);
    add("Average win", s.avgWin ? num(s.avgWin) : null);
    add("Average loss", s.avgLoss ? -Number(s.avgLoss) : null);
    add("Largest win", s.largestWin ? num(s.largestWin) : null);
    add("Largest loss", s.largestLoss ? num(s.largestLoss) : null);
    add("Max drawdown", num(s.maxDrawdown));
    add("Fees", num(s.fees));
    add("Funding", num(s.funding));
    summary.getRow(1).font = { bold: true };
    summary.getCell("B5").numFmt = "0.0%";

    const daily = wb.addWorksheet("Daily");
    daily.columns = [
      { header: "Day", key: "date", width: 12 },
      { header: "Trades", key: "trades", width: 8 },
      { header: "Net P&L", key: "pnl", width: 12 },
      { header: "Cumulative", key: "cum", width: 12 },
    ];
    for (const d of report.analytics.daily)
      daily.addRow({
        date: d.date,
        trades: d.trades,
        pnl: Number(d.pnl),
        cum: Number(d.cumulative),
      });
    daily.getRow(1).font = { bold: true };
  }

  const sheet = wb.addWorksheet("Trades");
  sheet.columns = COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.key === "notes" ? 50 : Math.max(10, c.header.length + 2),
  }));
  for (const r of rows) {
    sheet.addRow(
      Object.fromEntries(
        COLUMNS.map((c) => [c.key, c.numeric ? num(r[c.key]) : safeText(r[c.key])]),
      ),
    );
  }
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  wb.title = title;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const money = (v: string | null | undefined) => {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** The built-in PDF fonts cover Windows-1252 only: map the few other characters we produce. */
const pdfText = (t: string) =>
  t
    .replaceAll("\u2212", "-")
    .replaceAll("\u2011", "-")
    .replace(
      /[^\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC\n]/g,
      "?",
    );

/** A printable one-to-three page report. Built-in PDF fonts only (no files to ship). */
export function toPdf(report: ReportDto, trader: string): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 48,
    info: { Title: `Trading report ${report.label}`, Author: "AI Trading Coach" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks))),
  );
  const s = report.analytics.summary;
  const ink = "#111827";
  const muted = "#6b7280";
  const green = "#15803d";
  const red = "#b91c1c";
  const width = doc.page.width - 96;

  doc.fillColor("#b45309").fontSize(10).font("Helvetica-Bold").text("AI TRADING COACH");
  doc
    .moveDown(0.3)
    .fillColor(ink)
    .fontSize(20)
    .text(pdfText(`Trading report: ${report.label}`));
  doc
    .fillColor(muted)
    .fontSize(10)
    .font("Helvetica")
    .text(
      pdfText(
        `${trader} · ${report.from} to ${report.to} · ${report.analytics.range.timezone} · USD`,
      ),
    );
  doc.moveDown(1);

  const stats: [string, string][] = [
    ["Net P&L", money(s.netPnl)],
    ["Trades", `${s.trades} (${s.wins} won, ${s.losses} lost)`],
    ["Win rate", s.winRate === null ? "—" : `${(s.winRate * 100).toFixed(1)}%`],
    ["Profit factor", s.profitFactor === null ? "—" : s.profitFactor.toFixed(2)],
    ["Expectancy", `${money(s.expectancy)} per trade`],
    ["Average win / loss", `${money(s.avgWin)} / ${s.avgLoss ? money(`-${s.avgLoss}`) : "—"}`],
    ["Largest win / loss", `${money(s.largestWin)} / ${money(s.largestLoss)}`],
    ["Max drawdown", s.maxDrawdown === "0" ? "0.00" : money(`-${s.maxDrawdown}`)],
    ["Fees / funding", `${money(`-${s.fees}`)} / ${money(s.funding)}`],
  ];
  const colW = width / 2;
  for (let i = 0; i < stats.length; i += 2) {
    const top = doc.y;
    for (const [col, entry] of [stats[i], stats[i + 1]].entries()) {
      if (!entry) continue;
      const [k, v] = entry;
      const x = 48 + col * colW;
      const colour = k === "Net P&L" ? (Number(s.netPnl) >= 0 ? green : red) : ink;
      doc
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(9)
        .text(k, x, top, { width: colW - 12, lineBreak: false });
      doc
        .fillColor(colour)
        .font("Helvetica-Bold")
        .fontSize(13)
        .text(v, x, top + 11, { width: colW - 12, lineBreak: false });
    }
    doc.y = top + 34;
  }
  doc.font("Helvetica");
  doc.x = 48;
  doc.moveDown(1);

  // Daily (or monthly, for a year) P&L bars around a zero line.
  // Every day (or month) of the period, including the ones without trades.
  const byDay = new Map(report.analytics.daily.map((d) => [d.date, Number(d.pnl)]));
  const byMonth = new Map(report.analytics.monthly.map((m) => [m.month, Number(m.pnl)]));
  const series: { label: string; v: number }[] = [];
  if (report.period === "year") {
    for (let m = 1; m <= 12; m++) {
      const key = `${report.from.slice(0, 4)}-${String(m).padStart(2, "0")}`;
      series.push({ label: key.slice(5), v: byMonth.get(key) ?? 0 });
    }
  } else {
    for (
      let d = new Date(`${report.from}T00:00:00Z`);
      d <= new Date(`${report.to}T00:00:00Z`);
      d = new Date(d.getTime() + 86_400_000)
    ) {
      const key = d.toISOString().slice(0, 10);
      series.push({ label: key.slice(8), v: byDay.get(key) ?? 0 });
    }
  }
  if (report.analytics.summary.trades > 0 && series.length > 1) {
    doc
      .fillColor(ink)
      .fontSize(12)
      .font("Helvetica-Bold")
      .text(report.period === "year" ? "Net P&L by month" : "Net P&L by day");
    doc.font("Helvetica");
    const chartTop = doc.y + 6;
    const h = 110;
    const max = Math.max(...series.map((x) => Math.abs(x.v)), 1);
    const zero = chartTop + h / 2;
    const bw = Math.min(28, width / series.length - 2);
    doc
      .moveTo(48, zero)
      .lineTo(48 + width, zero)
      .lineWidth(0.5)
      .strokeColor("#d1d5db")
      .stroke();
    series.forEach((x, i) => {
      const bh = (Math.abs(x.v) / max) * (h / 2 - 4);
      const bx = 48 + i * (width / series.length) + 1;
      doc.rect(bx, x.v >= 0 ? zero - bh : zero, bw, Math.max(bh, 0.5)).fill(x.v >= 0 ? green : red);
      if (series.length <= 31)
        doc
          .fillColor(muted)
          .fontSize(6)
          .text(x.label, bx, chartTop + h + 2, { width: bw, align: "center" });
    });
    doc.x = 48;
    doc.y = chartTop + h + 18;
  }

  const tradesTable = (title: string, list: ReportDto["bestTrades"]) => {
    if (list.length === 0) return;
    doc.moveDown(0.6).fillColor(ink).fontSize(12).font("Helvetica-Bold").text(title, 48);
    doc.font("Helvetica").fontSize(9);
    for (const t of list) {
      doc
        .fillColor(ink)
        .text(
          `${t.closedAt?.slice(0, 10) ?? ""}  ${t.symbol} ${t.direction.toLowerCase()}`,
          48,
          doc.y,
          { continued: true, width: width - 90 },
        )
        .fillColor(Number(t.netPnl) >= 0 ? green : red)
        .text(`  ${money(t.netPnl)} ${t.settleAsset}`, { align: "right" });
    }
  };
  tradesTable("Best trades", report.bestTrades);
  tradesTable("Worst trades", report.worstTrades);

  if (report.behaviour.costByBehaviour.length > 0) {
    doc
      .moveDown(0.6)
      .fillColor(ink)
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("Behaviours detected", 48);
    doc.font("Helvetica").fontSize(9);
    for (const f of report.behaviour.flags) {
      doc
        .fillColor(ink)
        .text(`• ${f.code.replaceAll("_", " ").toLowerCase()}: `, { continued: true })
        .fillColor(muted)
        .text(pdfText(f.evidence));
    }
  }

  if (report.notes.length > 0) {
    doc.moveDown(0.6).fillColor(ink).fontSize(12).font("Helvetica-Bold").text("Coaching notes", 48);
    doc.font("Helvetica").fontSize(9);
    for (const n of report.notes) {
      doc
        .fillColor(ink)
        .font("Helvetica-Bold")
        .text(pdfText(`${n.kind === "DAILY" ? n.period : `Week of ${n.period}`}: ${n.headline}`));
      doc
        .font("Helvetica")
        .fillColor(muted)
        .text(pdfText(`Focus: ${n.focus}`))
        .moveDown(0.3);
    }
  }

  doc
    .moveDown(1)
    .fillColor(muted)
    .fontSize(7)
    .text(
      "Figures are computed from your exchange data; coaching is educational and not financial advice.",
      48,
    );
  doc.end();
  return done;
}
