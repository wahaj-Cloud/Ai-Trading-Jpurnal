import { type KeyRing, parseKeyRing } from "./key-ring.js";

/** Decrypts one KMS ciphertext (base64) to the plaintext master-key secret. */
export type KmsDecrypt = (ciphertextBase64: string) => Promise<string>;

export interface KeyRingConfig {
  /** Plain secrets: "v1:<secret>,v2:<secret>" (development, or platforms without KMS). */
  plain?: string;
  /** KMS-encrypted secrets: "v1:<base64 ciphertext>,v2:..." (production). */
  kms?: string;
  activeKeyId: string;
}

/**
 * Builds the master key ring. With KMS, the environment only ever holds ciphertexts: the secrets are
 * decrypted once at boot by the cloud key service (which logs every use) and kept in memory.
 */
export async function loadKeyRing(config: KeyRingConfig, decrypt?: KmsDecrypt): Promise<KeyRing> {
  if (config.kms) {
    const decryptFn = decrypt ?? (await awsKmsDecrypt());
    const entries = config.kms
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const plain: string[] = [];
    for (const entry of entries) {
      const sep = entry.indexOf(":");
      if (sep <= 0) throw new Error("Invalid CREDENTIAL_KEYS_KMS entry (use id:base64ciphertext)");
      plain.push(`${entry.slice(0, sep)}:${await decryptFn(entry.slice(sep + 1))}`);
    }
    return parseKeyRing(plain.join(","), config.activeKeyId);
  }
  if (!config.plain) throw new Error("Set CREDENTIAL_KEYS or CREDENTIAL_KEYS_KMS");
  return parseKeyRing(config.plain, config.activeKeyId);
}

/** AWS KMS via the official SDK, loaded only when KMS is configured (credentials from the environment). */
export async function awsKmsDecrypt(): Promise<KmsDecrypt> {
  const { KMSClient, DecryptCommand } = await import("@aws-sdk/client-kms");
  const client = new KMSClient({});
  return async (ciphertextBase64) => {
    const out = await client.send(
      new DecryptCommand({ CiphertextBlob: Buffer.from(ciphertextBase64, "base64") }),
    );
    if (!out.Plaintext) throw new Error("KMS returned no plaintext");
    return Buffer.from(out.Plaintext).toString("utf8");
  };
}
