import {
  type ExportQuery,
  exportQuerySchema,
  type ReportDto,
  type ReportQuery,
  reportQuerySchema,
} from "@atc/shared";
import { Controller, Get, Header, Query, Res, StreamableFile } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { CurrentUser } from "../auth/decorators.js";
import type { AuthenticatedUser } from "../common/request.types.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { toCsv, toPdf, toXlsx } from "./render.js";
import { ReportsService } from "./reports.service.js";

const fileName = (base: string, ext: string) => `${base.replace(/[^a-zA-Z0-9_-]+/g, "-")}.${ext}`;

@Controller({ version: "1" })
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("reports")
  report(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(reportQuerySchema)) q: ReportQuery,
  ): Promise<ReportDto> {
    return this.reports.report(user.id, q.period, q.date);
  }

  @Get("reports/pdf")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header("Content-Type", "application/pdf")
  async pdf(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(reportQuerySchema)) q: ReportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.report(user.id, q.period, q.date);
    const u = await this.prisma.client.user.findUnique({
      where: { id: user.id },
      select: { name: true, email: true },
    });
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName(`trading-report-${report.period}-${report.from}`, "pdf")}"`,
    );
    return new StreamableFile(await toPdf(report, u?.name ?? u?.email ?? "Trader"));
  }

  @Get("exports/trades.csv")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header("Content-Type", "text/csv; charset=utf-8")
  async csv(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(exportQuerySchema)) q: ExportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { rows, truncated } = await this.reports.exportRows(user.id, q);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName(`trades-${q.from ?? "all"}-${q.to ?? "now"}`, "csv")}"`,
    );
    if (truncated) res.setHeader("X-Export-Truncated", "true");
    return new StreamableFile(Buffer.from(toCsv(rows), "utf8"));
  }

  @Get("exports/trades.xlsx")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  async xlsx(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(exportQuerySchema)) q: ExportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { rows, truncated } = await this.reports.exportRows(user.id, q);
    // A workbook for a full period also carries its summary and daily sheets.
    const report = q.from && q.to ? await this.reports.reportRange(user.id, q.from, q.to) : null;
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName(`trades-${q.from ?? "all"}-${q.to ?? "now"}`, "xlsx")}"`,
    );
    if (truncated) res.setHeader("X-Export-Truncated", "true");
    return new StreamableFile(await toXlsx(report, rows, "Trades"));
  }
}
