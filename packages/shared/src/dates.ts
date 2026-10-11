import { z } from "zod";

/** A real calendar day as YYYY-MM-DD (rejects 2026-02-31 and 2026-99-99), between 2000 and 2100. */
export const isoDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((v) => {
    const [y, m, d] = v.split("-").map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return (
      y >= 2000 &&
      y <= 2100 &&
      date.getUTCFullYear() === y &&
      date.getUTCMonth() === m - 1 &&
      date.getUTCDate() === d
    );
  }, "Not a valid date");
