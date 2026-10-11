import { type ClerkClient, createClerkClient } from "@clerk/backend";
import { Global, Module } from "@nestjs/common";
import { ENV, type Env } from "../config/env.js";

export const CLERK_CLIENT = Symbol("CLERK_CLIENT");

@Global()
@Module({
  providers: [
    {
      provide: CLERK_CLIENT,
      inject: [ENV],
      useFactory: (env: Env): ClerkClient => createClerkClient({ secretKey: env.CLERK_SECRET_KEY }),
    },
  ],
  exports: [CLERK_CLIENT],
})
export class ClerkModule {}
