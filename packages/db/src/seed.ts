import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

// Plan limits are data, not code: admins can tune them without a deploy.
const plans = [
  {
    code: "FREE",
    name: "Free",
    sortOrder: 0,
    limits: { exchangeAccounts: 1, aiReviewsPerMonth: 20, historyDays: 30, coachMessagesPerDay: 5 },
  },
  {
    code: "PRO",
    name: "Pro",
    sortOrder: 1,
    limits: {
      exchangeAccounts: 5, // enough for all four supported exchanges plus a second account
      aiReviewsPerMonth: 300,
      historyDays: 365,
      coachMessagesPerDay: 50,
    },
  },
  {
    code: "PREMIUM",
    name: "Premium",
    sortOrder: 2,
    limits: {
      exchangeAccounts: 10,
      aiReviewsPerMonth: 2000,
      historyDays: -1,
      coachMessagesPerDay: 200,
    },
  },
  {
    code: "ENTERPRISE",
    name: "Enterprise",
    sortOrder: 3,
    isPublic: false,
    limits: {
      exchangeAccounts: -1,
      aiReviewsPerMonth: -1,
      historyDays: -1,
      coachMessagesPerDay: -1,
    },
  },
] as const;

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL or DATABASE_URL must be set");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

for (const plan of plans) {
  const { code, ...rest } = plan;
  // Create-only: once a plan exists, its limits are owned by admins, not overwritten on deploy.
  await prisma.plan.upsert({ where: { code }, create: { code, ...rest }, update: {} });
}
console.log(`Ensured ${plans.length} plans exist`);
await prisma.$disconnect();
