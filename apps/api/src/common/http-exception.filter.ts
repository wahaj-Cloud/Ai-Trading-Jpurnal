import type { ApiErrorBody } from "@atc/shared";
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { captureError } from "./monitoring.js";
import type { AppRequest } from "./request.types.js";

/** Uniform error shape. Unexpected errors are logged in full but never leak details to clients. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AppRequest>();

    let body: ApiErrorBody;
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const obj =
        typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
      body = {
        statusCode: status,
        error: HttpStatus[status] ?? "ERROR",
        message: typeof obj.message === "string" ? obj.message : exception.message,
        ...(Array.isArray(obj.issues) ? { issues: obj.issues as ApiErrorBody["issues"] } : {}),
        requestId: req.requestId,
      };
    } else {
      this.logger.error({ requestId: req.requestId, path: req.path, err: exception });
      captureError(exception, {
        requestId: req.requestId,
        route: req.route?.path as string | undefined,
      });
      body = {
        statusCode: 500,
        error: "INTERNAL_SERVER_ERROR",
        message: "Something went wrong. Quote this request ID if you contact support.",
        requestId: req.requestId,
      };
    }
    res.status(body.statusCode).json(body);
  }
}
