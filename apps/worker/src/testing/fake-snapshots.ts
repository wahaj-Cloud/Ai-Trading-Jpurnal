/**
 * For unit tests: the few SQL statements behind @atc/db's snapshot cache and `writeSnapshot`,
 * answered from a Map (key → data), so a fake database client can stand in for Postgres.
 */
export function fakeSnapshotSql(store: Map<string, unknown>) {
  const vers = new Map<string, number>();
  const at = new Map<string, Date>();
  const sql = (strings: TemplateStringsArray) => strings.join("?");
  const self = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = sql(strings);
      if (q.includes("INSERT INTO market_snapshots")) {
        const [key, json, updatedAt] = values as [string, string, Date];
        store.set(key, JSON.parse(json));
        vers.set(key, (vers.get(key) ?? 0) + 1);
        at.set(key, updatedAt);
        return [{ ver: String(vers.get(key)) }];
      }
      const keys = (values[0] as string[]).filter((k) => store.has(k));
      for (const k of keys) if (!vers.has(k)) vers.set(k, 1);
      if (q.includes("data, updated_at"))
        return keys.map((key) => ({
          key,
          ver: String(vers.get(key)),
          data: store.get(key),
          updatedAt: at.get(key) ?? new Date(0),
        }));
      return keys.map((key) => ({ key, ver: String(vers.get(key)) }));
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(self),
  };
  return self;
}
