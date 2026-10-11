import "dotenv/config";
import { defineConfig } from "prisma/config";

// Migrations use the DIRECT (non-pooled) connection; the app uses the pooled DATABASE_URL.
// `prisma generate` needs no database, so the URL is optional here (CI and web builds don't set it).
const directUrl = process.env.DIRECT_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "node dist/src/seed.js" },
  ...(directUrl ? { datasource: { url: directUrl } } : {}),
});
