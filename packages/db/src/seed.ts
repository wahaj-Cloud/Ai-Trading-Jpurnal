import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

// Plan limits are data, not code: admins can tune them without a deploy.
const plans = [
  {
    code: "FREE",
    name: "Free",
    sortOrder: 0,
    priceUsd: 0,
    limits: {
      exchangeAccounts: 1,
      aiReviewsPerMonth: 20,
      historyDays: 30,
      coachMessagesPerDay: 5,
      aiBudgetUsd: 0.3, // US$ of AI per month: keeps free users cheap
      brokerAccounts: 0,
    },
  },
  {
    code: "PRO",
    name: "Pro",
    sortOrder: 1,
    priceUsd: 15,
    limits: {
      exchangeAccounts: 2, // crypto exchanges; Exness is counted separately (brokerAccounts)
      aiReviewsPerMonth: 300,
      historyDays: 365,
      coachMessagesPerDay: 50,
      aiBudgetUsd: 3,
      brokerAccounts: 1, // one Exness account: a MetaApi terminal costs ~US$8 a month
    },
  },
  {
    code: "PREMIUM",
    name: "Premium",
    sortOrder: 2,
    priceUsd: 25,
    limits: {
      exchangeAccounts: 10,
      aiReviewsPerMonth: 2000,
      historyDays: -1,
      coachMessagesPerDay: 200,
      aiBudgetUsd: 7,
      brokerAccounts: 2,
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
      aiBudgetUsd: -1,
      brokerAccounts: -1,
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
