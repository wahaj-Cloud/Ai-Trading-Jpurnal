import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ConsoleLogger, VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Response } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module.js";
import { initMonitoring } from "./common/monitoring.js";
import type { AppRequest } from "./common/request.types.js";
import { loadEnv } from "./config/env.js";

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const isProd = env.NODE_ENV === "production";
  await initMonitoring(env.SENTRY_DSN, env.NODE_ENV, "api");

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // required for webhook signature verification
    logger: new ConsoleLogger({ json: isProd, colors: !isProd }),
  });

  app.set("trust proxy", env.TRUST_PROXY_HOPS);
  app.disable("x-powered-by");
  app.use(helmet());
  app.useBodyParser("json", { limit: "100kb" });
  app.use((req: AppRequest, res: Response, next: NextFunction) => {
    const incoming = req.get("x-request-id");
    req.requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader("x-request-id", req.requestId);
    next();
  });
  app.enableCors({
    origin: env.WEB_ORIGINS,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: ["authorization", "content-type", "x-request-id"],
    maxAge: 600,
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  app.enableShutdownHooks();

  await app.listen(env.PORT, "0.0.0.0");
}

bootstrap().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
