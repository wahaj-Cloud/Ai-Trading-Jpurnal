import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

import { meterClient } from "./meter.js";

export * from "../generated/prisma/client.js";
export { egressReport, meterClient } from "./meter.js";
export * from "./snapshots.js";

export function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  const client = new PrismaClient({ adapter });
  return process.env.DB_EGRESS_METRICS === "true" ? meterClient(client, "db") : client;
}
