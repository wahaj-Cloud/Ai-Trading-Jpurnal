import { CSV_COLUMNS, CSV_EXAMPLE_ROWS } from "@atc/shared";

/** The CSV template, with two example rows to overwrite. */
export function GET(): Response {
  const body = `${[CSV_COLUMNS.join(","), ...CSV_EXAMPLE_ROWS].join("\r\n")}\r\n`;
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="ai-trading-coach-trades-template.csv"',
      "cache-control": "no-store",
    },
  });
}
