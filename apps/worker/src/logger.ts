import { captureError } from "./monitoring.js";

/** Structured JSON logs (one line per event), readable by Railway and Better Stack. Never log secrets. */
type Level = "info" | "warn" | "error";

function write(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields }, (_k, v) =>
    v instanceof Error ? { name: v.name, message: v.message } : v,
  );
  (level === "error" ? process.stderr : process.stdout).write(`${line}\n`);
}

export const log = {
  info: (msg: string, fields?: Record<string, unknown>) => write("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => {
    write("error", msg, fields);
    captureError(fields?.err ?? new Error(msg), { msg });
  },
};
