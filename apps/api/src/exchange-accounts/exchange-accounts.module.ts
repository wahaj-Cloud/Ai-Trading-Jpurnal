import { Module } from "@nestjs/common";
import { credentialVaultProvider, exchangeAdaptersProvider } from "./exchange.providers.js";
import { ExchangeAccountsController } from "./exchange-accounts.controller.js";
import { ExchangeAccountsService } from "./exchange-accounts.service.js";

@Module({
  controllers: [ExchangeAccountsController],
  providers: [ExchangeAccountsService, credentialVaultProvider, exchangeAdaptersProvider],
})
export class ExchangeAccountsModule {}
