import type { FxRatesDto } from "@atc/shared";
import { Controller, Get } from "@nestjs/common";
import { FxService } from "./fx.service.js";

@Controller({ path: "fx", version: "1" })
export class FxController {
  constructor(private readonly fx: FxService) {}

  /** Latest daily rates (units per 1 USD), for showing amounts in the trader's currency. */
  @Get()
  latest(): Promise<FxRatesDto> {
    return this.fx.latest();
  }
}
