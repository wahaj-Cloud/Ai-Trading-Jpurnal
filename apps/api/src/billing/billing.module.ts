import { Global, Module } from "@nestjs/common";
import { BillingController } from "./billing.controller.js";
import { BillingService } from "./billing.service.js";
import { CryptoBillingService } from "./crypto.service.js";

@Global()
@Module({
  controllers: [BillingController],
  providers: [BillingService, CryptoBillingService],
  exports: [BillingService],
})
export class BillingModule {}
