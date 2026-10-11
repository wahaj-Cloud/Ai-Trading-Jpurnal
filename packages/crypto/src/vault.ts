import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { KeyRing } from "./key-ring.js";

const FORMAT_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;

export interface SealedFields<F extends string> {
  /** Which master key wrapped the data key. */
  keyId: string;
  wrappedDataKey: Buffer;
  fields: Record<F, Buffer>;
}

export class DecryptionError extends Error {
  constructor(message = "Credential could not be decrypted") {
    super(message);
    this.name = "DecryptionError";
  }
}

/**
 * Envelope encryption (AES-256-GCM):
 *  - every record gets a fresh random data key;
 *  - each field is encrypted with that data key, bound to the record and field name (AAD),
 *    so ciphertexts cannot be swapped between rows or columns;
 *  - the data key is encrypted ("wrapped") with the active master key.
 * Swapping the master-key backend for a cloud KMS only changes wrap/unwrap.
 */
export class CredentialVault {
  constructor(private readonly ring: KeyRing) {}

  seal<F extends string>(context: string, plaintext: Record<F, string>): SealedFields<F> {
    const dataKey = randomBytes(32);
    try {
      const fields = {} as Record<F, Buffer>;
      for (const name of Object.keys(plaintext) as F[]) {
        fields[name] = encrypt(
          dataKey,
          Buffer.from(plaintext[name], "utf8"),
          fieldAad(context, name),
        );
      }
      const keyId = this.ring.activeKeyId;
      const wrappedDataKey = encrypt(this.masterKey(keyId), dataKey, wrapAad(context, keyId));
      return { keyId, wrappedDataKey, fields };
    } finally {
      dataKey.fill(0);
    }
  }

  open<F extends string>(context: string, sealed: SealedFields<F>): Record<F, string> {
    const dataKey = decrypt(
      this.masterKey(sealed.keyId),
      sealed.wrappedDataKey,
      wrapAad(context, sealed.keyId),
    );
    try {
      const out = {} as Record<F, string>;
      for (const name of Object.keys(sealed.fields) as F[]) {
        out[name] = decrypt(dataKey, sealed.fields[name], fieldAad(context, name)).toString("utf8");
      }
      return out;
    } finally {
      dataKey.fill(0);
    }
  }

  /** Master-key rotation: re-wrap only the data key; field ciphertexts are untouched. */
  rewrap(
    context: string,
    keyId: string,
    wrappedDataKey: Buffer,
  ): { keyId: string; wrappedDataKey: Buffer } {
    const dataKey = decrypt(this.masterKey(keyId), wrappedDataKey, wrapAad(context, keyId));
    try {
      const target = this.ring.activeKeyId;
      return {
        keyId: target,
        wrappedDataKey: encrypt(this.masterKey(target), dataKey, wrapAad(context, target)),
      };
    } finally {
      dataKey.fill(0);
    }
  }

  private masterKey(id: string): Buffer {
    const key = this.ring.keys.get(id);
    if (!key) throw new DecryptionError(`Master key "${id}" is not configured`);
    return key;
  }
}

const fieldAad = (context: string, field: string) => Buffer.from(`field|${context}|${field}`);
const wrapAad = (context: string, keyId: string) => Buffer.from(`dek|${context}|${keyId}`);

function encrypt(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, cipher.getAuthTag(), ct]);
}

function decrypt(key: Buffer, blob: Buffer, aad: Buffer): Buffer {
  if (blob.length < HEADER_BYTES || blob[0] !== FORMAT_VERSION)
    throw new DecryptionError("Unknown ciphertext format");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, blob.subarray(1, 1 + IV_BYTES));
    decipher.setAAD(aad);
    decipher.setAuthTag(blob.subarray(1 + IV_BYTES, HEADER_BYTES));
    return Buffer.concat([decipher.update(blob.subarray(HEADER_BYTES)), decipher.final()]);
  } catch {
    throw new DecryptionError();
  }
}
