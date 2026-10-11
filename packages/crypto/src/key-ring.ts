import { hkdfSync } from "node:crypto";

/**
 * Master keys ("key-encryption keys") identified by an ID so they can be rotated:
 * new data is sealed with the active key; old data stays readable with retired keys.
 *
 * Spec format: "v1:<secret>,v2:<secret>". Each secret is high-entropy text (≥ 44 chars, e.g. a
 * password-manager-generated 64-char password). HKDF turns it into a uniform 256-bit AES key.
 */
export interface KeyRing {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}

const MIN_SECRET_LENGTH = 44;
const KEY_ID = /^[a-z0-9_-]{1,16}$/i;
/** Text copied from an example file instead of a real random secret. */
const PLACEHOLDER = /replace|example|placeholder|changeme|change-me|your-|same-value/i;

export function parseKeyRing(spec: string, activeKeyId: string): KeyRing {
  const keys = new Map<string, Buffer>();
  for (const entry of spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const sep = entry.indexOf(":");
    const id = entry.slice(0, sep);
    const secret = entry.slice(sep + 1);
    if (sep <= 0 || !KEY_ID.test(id)) throw new Error(`Invalid key id in key ring entry "${id}"`);
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `Key "${id}" is too short; use at least ${MIN_SECRET_LENGTH} random characters`,
      );
    }
    if (PLACEHOLDER.test(secret)) {
      throw new Error(
        `Key "${id}" is the example text, not a secret. Generate a new random 64-character password`,
      );
    }
    if (keys.has(id)) throw new Error(`Duplicate key id "${id}"`);
    keys.set(id, deriveKey(secret, id));
  }
  if (!keys.has(activeKeyId)) throw new Error(`Active key "${activeKeyId}" is not in the key ring`);
  return { activeKeyId, keys };
}

function deriveKey(secret: string, id: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "atc/credential-kek/v1", id, 32));
}
