import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module.js";
import { ClerkWebhookController } from "./clerk-webhook.controller.js";

@Module({ imports: [UsersModule], controllers: [ClerkWebhookController] })
export class WebhooksModule {}
