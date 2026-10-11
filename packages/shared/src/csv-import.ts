import { z } from "zod";
import { EXCHANGE_IDS } from "./exchanges.js";

/**
 * Our own CSV template for closed trades (history older than the exchanges' ~3 months, or trades
 * from anywhere else). Exchange-specific export formats can be mapped onto this later.
 */
export const CSV_COLUMNS = [
  "exchange",
  "symbol",
  "direction",
  "opened_at",
  "closed_at",
  "entry_price",
  "exit_price",
  "quantity",
  "fees",
  "funding",
  "net_pnl",
  "leverage",
] as const;

export const CSV_REQUIRED = [
  "exchange",
  "symbol",
  "direction",
  "opened_at",
  "closed_at",
  "entry_price",
  "exit_price",
  "quantity",
] as const;

export const CSV_EXAMPLE_ROWS = [
  "BINANCE,BTCUSDT,LONG,2026-03-02 09:15:00,2026-03-02 13:40:00,61250.5,62010,0.05,1.84,-0.12,,10",
  "BINGX,ETHUSDT,SHORT,2026-03-04T21:05:00Z,2026-03-05T02:30:00Z,3410,3380.25,1.2,0.98,0,,5",
];

export const MAX_IMPORT_ROWS = 5_000;
/** Imported trades one account may keep in total (protects shared statistics and AI work). */
export const MAX_STORED_CSV_TRADES = 25_000;
/** Rows per API request, keeping each request small. */
export const IMPORT_CHUNK = 200;

const decimal = z
  .string()
  .trim()
  .regex(
    /^-?\d{1,15}(\.\d{1,18})?$/,
    "Use a plain number, e.g. 61250.5 (no currency signs or thousands separators).",
  );
const positive = decimal.refine((v) => Number(v) > 0, "Must be greater than 0.");
const optionalDecimal = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .pipe(decimal.optional());

/** ISO 8601, or "YYYY-MM-DD HH:mm[:ss]" read as UTC. */
const timestamp = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v)
      ? `${v.replace(" ", "T")}Z`
      : v;
    const d = new Date(normalized);
    if (!/^\d{4}-\d{2}-\d{2}/.test(v) || Number.isNaN(d.getTime())) {
      ctx.addIssue({
        code: "custom",
        message: "Use a date like 2026-03-02 09:15:00 (UTC) or 2026-03-02T09:15:00Z.",
      });
      return z.NEVER;
    }
    return d.toISOString();
  });

export const importRowSchema = z
  .object({
    exchange: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .pipe(z.enum(EXCHANGE_IDS, { message: `Use one of ${EXCHANGE_IDS.join(", ")}.` })),
    symbol: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase().replace(/[^A-Z0-9]/g, ""))
      .pipe(z.string().min(2, "Enter the symbol, e.g. BTCUSDT.").max(30)),
    direction: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .pipe(z.enum(["LONG", "SHORT"], { message: "Use LONG or SHORT." })),
    opened_at: timestamp,
    closed_at: timestamp,
    entry_price: positive,
    exit_price: positive,
    quantity: positive,
    fees: optionalDecimal,
    funding: optionalDecimal,
    net_pnl: optionalDecimal,
    leverage: optionalDecimal.refine(
      (v) => v === undefined || (Number(v) > 0 && Number(v) <= 1000),
      "Leverage must be between 0 and 1000, e.g. 10.",
    ),
  })
  .refine((r) => r.closed_at >= r.opened_at, {
    path: ["closed_at"],
    message: "Must not be before opened_at.",
  })
  .refine(
    (r) =>
      Math.max(Number(r.entry_price), Number(r.exit_price)) * Number(r.quantity) < 1e15 &&
      [r.fees, r.funding, r.net_pnl].every((v) => v === undefined || Math.abs(Number(v)) < 1e15),
    { path: ["quantity"], message: "The trade size is too large to be real. Check the numbers." },
  );

export type ImportRow = z.infer<typeof importRowSchema>;

export const importRequestSchema = z
  .object({ rows: z.array(importRowSchema).min(1).max(IMPORT_CHUNK) })
  .strict();

export interface ImportResult {
  imported: number;
  updated: number;
  /** Rows covered by history already synced from a connected account of that exchange. */
  skippedAlreadySynced: number;
}

export interface CsvParseResult {
  rows: ImportRow[];
  errors: { line: number; message: string }[];
}

/** RFC 4180 CSV (quoted fields, escaped quotes, CRLF or LF). */
export function parseCsvText(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      out.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  return out.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Parses and validates a whole file, collecting every problem with its line number. */
export function parseImportCsv(text: string): CsvParseResult {
  const table = parseCsvText(text);
  const errors: CsvParseResult["errors"] = [];
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const missing = CSV_REQUIRED.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [
        { line: 1, message: `Missing columns: ${missing.join(", ")}. Start from the template.` },
      ],
    };
  }
  if (table.length - 1 > MAX_IMPORT_ROWS) {
    return {
      rows: [],
      errors: [{ line: 1, message: `Import at most ${MAX_IMPORT_ROWS} trades per file.` }],
    };
  }

  const rows: ImportRow[] = [];
  table.slice(1).forEach((cells, index) => {
    const record: Record<string, string> = {};
    for (const col of CSV_COLUMNS) {
      const at = header.indexOf(col);
      record[col] = at >= 0 ? (cells[at] ?? "") : "";
    }
    const parsed = importRowSchema.safeParse(record);
    if (parsed.success) rows.push(parsed.data);
    else {
      const issue = parsed.error.issues[0];
      errors.push({
        line: index + 2,
        message: `${String(issue?.path[0] ?? "row")}: ${issue?.message ?? "Invalid"}`,
      });
    }
  });
  return { rows, errors };
}
