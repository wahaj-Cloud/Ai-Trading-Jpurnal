import { type NewsPageDto, type NewsQuery, newsQuerySchema } from "@atc/shared";
import { Controller, Get, Module, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { NewsService } from "./news.service.js";

@Controller({ path: "news", version: "1" })
export class NewsController {
  constructor(private readonly news: NewsService) {}

  /** Headlines of one folder (or Top stories), newest first. */
  @Get()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  list(@Query(new ZodValidationPipe(newsQuerySchema)) q: NewsQuery): Promise<NewsPageDto> {
    return this.news.list(q);
  }
}

@Module({ controllers: [NewsController], providers: [NewsService] })
export class NewsModule {}
