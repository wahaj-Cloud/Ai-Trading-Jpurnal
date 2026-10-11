import { describe, expect, it } from "vitest";
import {
  CSV_COLUMNS,
  CSV_EXAMPLE_ROWS,
  importRowSchema,
  parseCsvText,
  parseImportCsv,
} from "./csv-import.js";

const header = CSV_COLUMNS.join(",");

describe("parseCsvText", () => {
  it("handles quotes, escaped quotes, CRLF and a byte-order mark", () => {
    expect(parseCsvText('﻿a,"b,c","say ""hi"""\r\n1,2,3\r\n')).toEqual([
      ["a", "b,c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
  });
});

describe("parseImportCsv", () => {
  it("accepts the template's example rows and normalises values", () => {
    const { rows, errors } = parseImportCsv([header, ...CSV_EXAMPLE_ROWS].join("\n"));
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      exchange: "BINANCE",
      symbol: "BTCUSDT",
      direction: "LONG",
      opened_at: "2026-03-02T09:15:00.000Z",
      fees: "1.84",
      net_pnl: undefined,
    });
    expect(rows[1]?.opened_at).toBe("2026-03-04T21:05:00.000Z");
  });

  it("reports every bad row with its spreadsheet line number", () => {
    const text = [
      header,
      CSV_EXAMPLE_ROWS[0],
      "FTX,BTCUSDT,LONG,2026-03-02 09:15:00,2026-03-02 13:40:00,1,1,1,,,,",
      "BINANCE,BTCUSDT,LONG,03/02/2026,2026-03-02 13:40:00,1,1,1,,,,",
      'BINANCE,BTCUSDT,LONG,2026-03-02 09:15:00,2026-03-01 13:40:00,"1,000",1,1,,,,',
    ].join("\n");
    const { rows, errors } = parseImportCsv(text);
    expect(rows).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(errors[0]?.message).toMatch(/^exchange:/);
    expect(errors[1]?.message).toMatch(/^opened_at:/);
  });

  it("rejects files without the required columns", () => {
    expect(parseImportCsv("symbol,side\nBTC,LONG").errors[0]?.message).toMatch(
      /Missing columns: exchange/,
    );
  });

  it("accepts columns in any order", () => {
    const cols = [...CSV_COLUMNS].reverse();
    const values = (CSV_EXAMPLE_ROWS[0] ?? "").split(",").reverse();
    expect(parseImportCsv(`${cols.join(",")}\n${values.join(",")}`).rows).toHaveLength(1);
  });
});

describe("importRowSchema limits", () => {
  const row = {
    exchange: "BINANCE",
    symbol: "BTCUSDT",
    direction: "LONG",
    opened_at: "2026-03-02 09:15:00",
    closed_at: "2026-03-02 13:40:00",
    entry_price: "61250.5",
    exit_price: "62010",
    quantity: "0.05",
    fees: "",
    funding: "",
    net_pnl: "",
    leverage: "10",
  };
  it("accepts a normal trade", () => {
    expect(importRowSchema.safeParse(row).success).toBe(true);
  });
  it.each([
    [{ leverage: "-5" }, "negative leverage"],
    [{ leverage: "5000" }, "absurd leverage"],
    [{ quantity: "99999999999999" }, "impossible size"],
    [{ entry_price: "1234567890123456789" }, "too many digits"],
    [{ fees: "1e9" }, "scientific notation"],
  ])("rejects %j (%s)", (extra) => {
    expect(importRowSchema.safeParse({ ...row, ...extra }).success).toBe(false);
  });
});
