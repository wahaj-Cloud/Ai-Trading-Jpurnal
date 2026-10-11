# Phase 9 — Reports and exports

## Purpose
Daily, weekly, monthly and yearly performance reports on screen and as PDF, plus trade exports to
Excel and CSV.

## Architecture
- `apps/api/src/reports/reports.service.ts` — period bounds in the user's timezone. It reuses
  `@atc/analytics`, so the figures match the dashboard.
- `render.ts`:
  - CSV: UTF-8 BOM, and cells starting with `= + - @` are neutralised against formula injection.
  - Excel: built with exceljs.
  - PDF: built with pdfkit; text is sanitised for the built-in fonts.
- Web: `/reports` and a `/reports/download` route handler that streams files through the server, so
  the API is never exposed to the browser.

## Database changes
None.

## API endpoints
`GET /v1/reports`, `GET /v1/reports/pdf`, `GET /v1/exports/trades.csv`, `GET /v1/exports/trades.xlsx`.

## Future improvements
Scheduled PDF reports attached to email; branded PDF theme; shareable read-only report links.
