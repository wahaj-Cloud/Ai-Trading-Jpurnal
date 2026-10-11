import type { VerificationFailure } from "../types.js";
import { type MetaApiAccountInformation, type MetaApiClient, MetaApiError } from "./metaapi.js";

/** Non-secret connection state, stored on the exchange account (never holds the password). */
export interface MetatraderMetadata {
  server: string;
  platform: "mt4" | "mt5";
  /** Set before the first create call so a retried request is recognised as the same one. */
  transactionId?: string;
  metaapiAccountId?: string;
  region?: string;
  /** When we first asked MetaApi to start the terminal (ms since epoch). */
  deployRequestedAt?: number;
  /** MetaApi accounts replaced by a reconnect, still to be removed (billing). */
  retiredMetaapiIds?: string[];
}

export type ProvisionOutcome =
  /** Logged in with the investor password: sync can start. */
  | { status: "READY"; metadata: MetatraderMetadata; info: MetaApiAccountInformation }
  /** Still connecting: try again in a minute or two. */
  | { status: "PENDING"; metadata: MetatraderMetadata; retryAt: Date | null }
  /** Cannot work as entered. `remove`: the MetaApi account must be deleted. */
  | {
      status: "FAILED";
      metadata: MetatraderMetadata;
      failure: VerificationFailure;
      remove: boolean;
    };

/** A login that is still not connected this long after deploying is treated as a wrong password. */
export const CONNECT_TIMEOUT_MS = 10 * 60_000;

/**
 * One step of connecting a MetaTrader account at MetaApi, safe to repeat: create the cloud
 * account (with the investor password), start it, wait until it has logged in to the broker, then
 * prove the session is read-only (investor mode). Each call moves as far as it can and says what
 * to do next; the caller stores the returned metadata.
 */
export async function provisionStep(
  client: MetaApiClient,
  metadata: MetatraderMetadata,
  credentials: { login: string; password: string },
  ctx: { accountId: string; brokerName: string; now: number },
): Promise<ProvisionOutcome> {
  let meta = { ...metadata };
  if (!meta.metaapiAccountId) {
    if (!meta.transactionId) throw new Error("transactionId must be stored before creating");
    try {
      const created = await client.createAccount(
        {
          name: `atc-${ctx.accountId}`,
          login: credentials.login,
          password: credentials.password,
          server: meta.server,
          platform: meta.platform,
          keywords: [ctx.brokerName],
          metadata: { app: "ai-trading-coach", accountId: ctx.accountId },
        },
        meta.transactionId,
      );
      if (created.status === "PENDING")
        return { status: "PENDING", metadata: meta, retryAt: created.retryAt };
      meta = { ...meta, metaapiAccountId: created.id };
    } catch (err) {
      const failure = createFailure(err, meta.server, ctx.brokerName);
      if (failure) return { status: "FAILED", metadata: meta, failure, remove: false };
      throw err;
    }
  }

  const id = meta.metaapiAccountId as string;
  const account = await client.getAccount(id).catch((err: unknown) => {
    if (err instanceof MetaApiError && err.status === 404) return null;
    throw err;
  });
  if (!account) {
    // Removed at MetaApi (e.g. by support): start over with a new request.
    const { metaapiAccountId: _gone, transactionId: _old, deployRequestedAt: _t, ...rest } = meta;
    return { status: "PENDING", metadata: rest, retryAt: null };
  }
  meta = { ...meta, region: account.region };

  if (["CREATED", "UNDEPLOYED", "DEPLOY_FAILED", "REDEPLOY_FAILED"].includes(account.state)) {
    await client.deploy(id);
    return {
      status: "PENDING",
      metadata: { ...meta, deployRequestedAt: meta.deployRequestedAt ?? ctx.now },
      retryAt: null,
    };
  }
  if (account.state !== "DEPLOYED") return { status: "PENDING", metadata: meta, retryAt: null };
  meta.deployRequestedAt ??= ctx.now;

  if (account.connectionStatus !== "CONNECTED") {
    if (ctx.now - meta.deployRequestedAt > CONNECT_TIMEOUT_MS) {
      return {
        status: "FAILED",
        metadata: meta,
        remove: true,
        failure: {
          ok: false,
          code: "INVALID_SECRET",
          message: `${ctx.brokerName} did not accept this login. Check the account number, the investor password and the server name, then connect again.`,
        },
      };
    }
    return { status: "PENDING", metadata: meta, retryAt: null };
  }

  const info = await client.accountInformation({ id, region: account.region });
  const unsafe = readOnlyFailure(info);
  if (unsafe) return { status: "FAILED", metadata: meta, failure: unsafe, remove: true };
  return { status: "READY", metadata: meta, info };
}

/**
 * The read-only promise: the session must have been opened with the investor password. Fail
 * closed: if MetaApi does not say so, the connection is refused.
 */
export function readOnlyFailure(info: MetaApiAccountInformation): VerificationFailure | null {
  if (info.investorMode === true) return null;
  return {
    ok: false,
    code: "UNSAFE_PERMISSIONS",
    message:
      "This password can trade. Connect with the investor (read-only) password instead, so the app can never place trades. We did not keep the password.",
    details: ["Trading (master) password used"],
  };
}

function createFailure(err: unknown, server: string, broker: string): VerificationFailure | null {
  if (!(err instanceof MetaApiError) || err.status !== 400) return null;
  if (err.code === "E_SRV_NOT_FOUND") {
    const close = err.suggestions.filter((s) => s.toLowerCase().includes(broker.toLowerCase()));
    return {
      ok: false,
      code: "INVALID_KEY",
      message: `We could not find the server "${server}". Copy the server name exactly as ${broker} shows it for this account.`,
      details: close.slice(0, 6).map((s) => `Did you mean ${s}?`),
    };
  }
  if (err.code === "E_AUTH") {
    return {
      ok: false,
      code: "INVALID_SECRET",
      message: `${broker} did not accept this account number and investor password on server "${server}".`,
    };
  }
  if (err.code === "E_SERVER_TIMEZONE") return null; // temporary: retried
  return {
    ok: false,
    code: "INVALID_KEY",
    message:
      "These MetaTrader details were not accepted. Check the account number, password, server and platform.",
  };
}
