import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  /** Internal URL of the API service, e.g. https://api.yourdomain.com. Never exposed to browsers. */
  API_URL: z.url(),
});

let cached: z.infer<typeof serverEnvSchema> | undefined;

export function serverEnv(): z.infer<typeof serverEnvSchema> {
  if (!cached) {
    const parsed = serverEnvSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        `Invalid web environment: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
      );
    }
    cached = parsed.data;
  }
  return cached;
}
