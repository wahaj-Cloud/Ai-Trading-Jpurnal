import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const valid = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  CLERK_SECRET_KEY: "sk_test_abc",
  CLERK_WEBHOOK_SIGNING_SECRET: "whsec_abc",
  WEB_ORIGINS: "https://app.example.com, http://localhost:3000",
  CREDENTIAL_KEYS: "v1:x",
  REDIS_URL: "redis://localhost:6379",
};

describe("loadEnv", () => {
  it("parses a valid configuration and splits origins", () => {
    const env = loadEnv(valid);
    expect(env.WEB_ORIGINS).toEqual(["https://app.example.com", "http://localhost:3000"]);
    expect(env.PORT).toBe(4000);
    expect(env.EXCHANGE_EGRESS_IPS).toEqual([]);
  });

  it("fails fast with every problem listed", () => {
    expect(() =>
      loadEnv({ ...valid, CLERK_SECRET_KEY: "pk_live_wrong", WEB_ORIGINS: "not-a-url" }),
    ).toThrow(/CLERK_SECRET_KEY[\s\S]*WEB_ORIGINS/);
  });
});

it("rejects malformed egress IPs", () => {
  expect(() => loadEnv({ ...valid, EXCHANGE_EGRESS_IPS: "1.2.3.4, nope" })).toThrow(
    /EXCHANGE_EGRESS_IPS/,
  );
});

describe("billing configuration", () => {
  const prices = "PRO:month:pri_aaa,PRO:year:pri_bbb";
  it("requires webhook secret and API key when plans are sold", () => {
    expect(() => loadEnv({ ...valid, PADDLE_PRICES: prices })).toThrow(
      /PADDLE_WEBHOOK_SECRET[\s\S]*PADDLE_API_KEY/,
    );
    const env = loadEnv({
      ...valid,
      PADDLE_PRICES: prices,
      PADDLE_WEBHOOK_SECRET: "pdl_ntfset_x",
      PADDLE_API_KEY: "pdl_key",
    });
    expect(env.PADDLE_PRICES).toHaveLength(2);
  });

  it("rejects duplicate prices", () => {
    expect(() =>
      loadEnv({
        ...valid,
        PADDLE_PRICES: "PRO:month:pri_aaa,PREMIUM:month:pri_aaa",
        PADDLE_WEBHOOK_SECRET: "s",
        PADDLE_API_KEY: "k",
      }),
    ).toThrow(/Duplicate/);
  });

  it("needs plain or KMS master keys", () => {
    const { CREDENTIAL_KEYS: _omit, ...rest } = valid;
    expect(() => loadEnv(rest)).toThrow(/CREDENTIAL_KEYS/);
    expect(loadEnv({ ...rest, CREDENTIAL_KEYS_KMS: "v1:abc" }).CREDENTIAL_KEYS_KMS).toBe("v1:abc");
  });
});

describe("pasted values", () => {
  it("treats empty optional settings as unset and trims spaces", () => {
    const env = loadEnv({
      ...valid,
      SENTRY_DSN: "",
      ANTHROPIC_API_KEY: "  ",
      PADDLE_API_KEY: "",
      CLERK_SECRET_KEY: " sk_test_abc ",
      WEB_ORIGINS: "https://app.example.com/",
    });
    expect(env.SENTRY_DSN).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLERK_SECRET_KEY).toBe("sk_test_abc");
    expect(env.WEB_ORIGINS).toEqual(["https://app.example.com"]);
  });
});
