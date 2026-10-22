import type { PrismaClient } from "../generated/prisma/client.js";

/**
 * Optional database transfer meter (DB_EGRESS_METRICS=true): every query's result size, summed per
 * model and operation, logged as the top 10 every 10 minutes. Sizes are the JSON length of the
 * result, close to what the database sends. Off by default: measuring costs a little CPU.
 */

const totals = new Map<string, { calls: number; bytes: number }>();
let timer: ReturnType<typeof setInterval> | null = null;

function sizeOf(v: unknown): number {
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x))?.length ?? 0;
  } catch {
    return 0;
  }
}

export function egressReport(): Array<{ query: string; calls: number; mb: number }> {
  return [...totals.entries()]
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, 10)
    .map(([query, t]) => ({ query, calls: t.calls, mb: Math.round(t.bytes / 10_485.76) / 100 }));
}

export function meterClient(client: PrismaClient, label: string): PrismaClient {
  timer ??= setInterval(() => {
    console.log(
      JSON.stringify({ msg: "db egress (top 10, since start)", label, top: egressReport() }),
    );
  }, 600_000);
  timer.unref?.();
  return client.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        const result = await query(args);
        const k = `${model ?? "raw"}.${operation}`;
        const t = totals.get(k) ?? { calls: 0, bytes: 0 };
        t.calls++;
        t.bytes += sizeOf(result);
        totals.set(k, t);
        return result;
      },
    },
  }) as unknown as PrismaClient;
}
