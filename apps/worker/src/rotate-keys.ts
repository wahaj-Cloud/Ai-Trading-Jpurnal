import type { CredentialVault } from "@atc/crypto";
import type { PrismaClient } from "@atc/db";
import { log } from "./logger.js";

const BATCH = 200;
/** Records that could not be re-wrapped in this process (old key missing); not retried each run. */
const failed = new Set<string>();

/**
 * Master-key rotation without downtime or scripts: after a new key is added to the key ring and
 * made active, every stored credential still wrapped with an older key is re-wrapped with the active
 * one, a batch at a time. Field ciphertexts are untouched (only each record's data key is
 * re-encrypted), so a retired key can be removed once this reports nothing left.
 */
export async function rewrapCredentials(
  db: PrismaClient,
  vault: CredentialVault,
  activeKeyId: string,
): Promise<number> {
  const stale = await db.exchangeCredential.findMany({
    where: { keyId: { not: activeKeyId }, accountId: { notIn: [...failed] } },
    select: { accountId: true, keyId: true, wrappedDataKey: true },
    take: BATCH,
  });
  let done = 0;
  for (const c of stale) {
    try {
      const next = vault.rewrap(c.accountId, c.keyId, Buffer.from(c.wrappedDataKey));
      // Conditional update: a credential replaced meanwhile is left alone.
      const res = await db.exchangeCredential.updateMany({
        where: { accountId: c.accountId, keyId: c.keyId },
        data: {
          keyId: next.keyId,
          wrappedDataKey: new Uint8Array(next.wrappedDataKey),
          rotatedAt: new Date(),
        },
      });
      done += res.count;
    } catch (err) {
      failed.add(c.accountId);
      // A record whose old key is missing from the ring cannot be re-wrapped; the account's next
      // sync reports it as needing a reconnect.
      log.error("credential re-wrap failed", { accountId: c.accountId, keyId: c.keyId, err });
    }
  }
  if (done > 0) log.info("credentials re-wrapped with the active master key", { done });
  return done;
}
