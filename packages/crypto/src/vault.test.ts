import { describe, expect, it } from "vitest";
import { parseKeyRing } from "./key-ring.js";
import { CredentialVault, DecryptionError } from "./vault.js";

const s1 = "a".repeat(20) + "B3x9-qLm2Zr8Wt5Yp1Nc7Vd4Hk6Js0Fg";
const s2 = "z".repeat(20) + "Q7w2-eR5tY8uI1oP4aS6dF9gH3jK0lZx";
const creds = { apiKey: "PUBLICKEY123", apiSecret: "SECRET456" };

describe("CredentialVault", () => {
  const vault = new CredentialVault(parseKeyRing(`v1:${s1}`, "v1"));

  it("round-trips fields and never stores plaintext", () => {
    const sealed = vault.seal("acct-1", creds);
    expect(sealed.fields.apiSecret.includes(Buffer.from("SECRET456"))).toBe(false);
    expect(vault.open("acct-1", sealed)).toEqual(creds);
  });

  it("produces different ciphertext for identical input", () => {
    expect(
      vault.seal("acct-1", creds).fields.apiKey.equals(vault.seal("acct-1", creds).fields.apiKey),
    ).toBe(false);
  });

  it("rejects a ciphertext moved to another record", () => {
    expect(() => vault.open("acct-2", vault.seal("acct-1", creds))).toThrow(DecryptionError);
  });

  it("rejects fields swapped between columns", () => {
    const sealed = vault.seal("acct-1", creds);
    const swapped = {
      ...sealed,
      fields: { apiKey: sealed.fields.apiSecret, apiSecret: sealed.fields.apiKey },
    };
    expect(() => vault.open("acct-1", swapped)).toThrow(DecryptionError);
  });

  it("rejects tampered ciphertext", () => {
    const sealed = vault.seal("acct-1", creds);
    const tampered = Buffer.from(sealed.fields.apiSecret);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    expect(() =>
      vault.open("acct-1", { ...sealed, fields: { ...sealed.fields, apiSecret: tampered } }),
    ).toThrow(DecryptionError);
  });

  it("keeps old records readable after master-key rotation and can re-wrap them", () => {
    const old = vault.seal("acct-1", creds);
    const rotated = new CredentialVault(parseKeyRing(`v1:${s1},v2:${s2}`, "v2"));
    expect(rotated.open("acct-1", old)).toEqual(creds);
    const rewrapped = { ...old, ...rotated.rewrap("acct-1", old.keyId, old.wrappedDataKey) };
    expect(rewrapped.keyId).toBe("v2");
    expect(new CredentialVault(parseKeyRing(`v2:${s2}`, "v2")).open("acct-1", rewrapped)).toEqual(
      creds,
    );
  });
});

describe("parseKeyRing", () => {
  it("rejects short secrets and a missing active key", () => {
    expect(() => parseKeyRing("v1:short", "v1")).toThrow(/too short/);
    expect(() => parseKeyRing(`v1:${s1}`, "v2")).toThrow(/not in the key ring/);
  });
  it("rejects the example text from .env.example", () => {
    expect(() =>
      parseKeyRing(
        "v1:replace-with-64-random-letters-and-numbers-from-your-password-manager",
        "v1",
      ),
    ).toThrow(/example text/);
  });
});

describe("loadKeyRing", () => {
  it("decrypts KMS ciphertexts once and builds the same ring as plain secrets", async () => {
    const { loadKeyRing } = await import("./kms.js");
    const secret = "k".repeat(50);
    const calls: string[] = [];
    const ring = await loadKeyRing(
      { kms: `v1:${Buffer.from("cipher").toString("base64")}`, activeKeyId: "v1" },
      async (c) => {
        calls.push(c);
        return secret;
      },
    );
    const plain = await loadKeyRing({ plain: `v1:${secret}`, activeKeyId: "v1" });
    expect(calls).toHaveLength(1);
    expect(ring.keys.get("v1")?.equals(plain.keys.get("v1") as Buffer)).toBe(true);
  });

  it("refuses to start without keys", async () => {
    const { loadKeyRing } = await import("./kms.js");
    await expect(loadKeyRing({ activeKeyId: "v1" })).rejects.toThrow(/CREDENTIAL_KEYS/);
  });
});
