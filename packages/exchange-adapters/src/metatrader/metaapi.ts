import { randomBytes } from "node:crypto";
import { readCapped, resolveFetch } from "../http.js";
import { type ClientOptions, ExchangeNetworkError } from "../types.js";

/**
 * MetaApi (metaapi.cloud) REST client: runs MetaTrader 4/5 terminals in the cloud so we can read a
 * broker account's history with its investor (read-only) password. Only the calls a read-only
 * journal needs are implemented.
 *
 * Hosts: provisioning is global; account data is served from a regional host
 * `mt-client-api-v1.<region>.<domain>`, where <domain> comes from the provisioning API.
 */
export interface MetaApiOptions extends ClientOptions {
  /** API access token from app.metaapi.cloud. Without it, MetaTrader connections are off. */
  token?: string;
  provisioningUrl?: string;
  /** Tests: fixed base URL for the regional client API instead of resolving the domain. */
  clientBaseUrl?: (region: string) => string;
}

export const METAAPI_PROVISIONING_URL =
  "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";

export class MetaApiError extends Error {
  constructor(
    readonly status: number,
    /** MetaApi error code, e.g. E_AUTH, E_SRV_NOT_FOUND, TooManyRequestsError. */
    readonly code: string | null,
    message: string,
    /** Server names MetaApi suggests when the one given was not found. */
    readonly suggestions: string[] = [],
    readonly retryAt: Date | null = null,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500 || this.code === "E_SERVER_TIMEZONE";
  }
}

export class MetaApiNotConfiguredError extends Error {
  constructor() {
    super("MetaTrader connections are not configured (METAAPI_TOKEN is missing)");
    this.name = "MetaApiNotConfiguredError";
  }
}

export type MetaApiAccountState =
  | "CREATED"
  | "DEPLOYING"
  | "DEPLOYED"
  | "DEPLOY_FAILED"
  | "UNDEPLOYING"
  | "UNDEPLOYED"
  | "UNDEPLOY_FAILED"
  | "DELETING"
  | "DELETE_FAILED"
  | "REDEPLOY_FAILED"
  | "DRAFT";

export interface MetaApiAccount {
  _id: string;
  state: MetaApiAccountState;
  connectionStatus: "CONNECTED" | "DISCONNECTED" | "DISCONNECTED_FROM_BROKER";
  region: string;
  login?: string;
  server?: string;
}

export interface MetaApiAccountInformation {
  platform: "mt4" | "mt5";
  broker?: string;
  currency: string;
  server: string;
  login: number | string;
  leverage?: number;
  tradeAllowed?: boolean;
  /** True when the investor (read-only) password was used. */
  investorMode?: boolean;
  type?: string;
}

export interface MetaApiDeal {
  id: string;
  type: string;
  entryType?: "DEAL_ENTRY_IN" | "DEAL_ENTRY_OUT" | "DEAL_ENTRY_INOUT" | "DEAL_ENTRY_OUT_BY";
  symbol?: string;
  time: string;
  volume?: number;
  price?: number;
  commission?: number;
  swap?: number;
  profit: number;
  positionId?: string;
  orderId?: string;
  stopLoss?: number;
  takeProfit?: number;
  reason?: string;
}

export interface MetaApiPosition {
  id: string | number;
  type: "POSITION_TYPE_BUY" | "POSITION_TYPE_SELL";
  symbol: string;
  time: string;
  openPrice: number;
  currentPrice?: number;
  volume: number;
  swap?: number;
  commission?: number;
  unrealizedProfit?: number;
  profit?: number;
}

export interface MetaApiSymbolSpecification {
  symbol: string;
  contractSize?: number;
  baseCurrency?: string;
  profitCurrency?: string;
  digits?: number;
}

export interface CreateAccountInput {
  name: string;
  login: string;
  password: string;
  server: string;
  platform: "mt4" | "mt5";
  keywords?: string[];
  metadata?: Record<string, string>;
}

export type CreateAccountResult =
  | { status: "CREATED"; id: string }
  | { status: "PENDING"; retryAt: Date | null };

const DEALS_PAGE = 1000;

export const newTransactionId = (): string => randomBytes(16).toString("hex");

export class MetaApiClient {
  readonly enabled: boolean;
  private readonly fetchFn: typeof fetch;
  private readonly provisioning: string;
  private readonly timeoutMs: number;
  private domain: Promise<string> | undefined;

  constructor(private readonly options: MetaApiOptions = {}) {
    this.enabled = Boolean(options.token);
    this.fetchFn = resolveFetch(options);
    this.provisioning = options.provisioningUrl ?? METAAPI_PROVISIONING_URL;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  // ─── Provisioning ───

  /**
   * Creates the cloud MetaTrader account. A 202 means MetaApi is still detecting the broker's
   * settings; the same request (same transaction ID) is sent again later.
   */
  async createAccount(
    input: CreateAccountInput,
    transactionId: string,
  ): Promise<CreateAccountResult> {
    const res = await this.call("POST", `${this.provisioning}/users/current/accounts`, {
      body: {
        ...input,
        magic: 0,
        type: "cloud-g2",
        // A journal does not need the doubled cost of high reliability.
        reliability: "regular",
      },
      headers: { "transaction-id": transactionId },
      accept: [201, 202],
    });
    if (res.status === 202) return { status: "PENDING", retryAt: retryAfter(res) };
    const id = String((res.json as { id?: string } | null)?.id ?? "");
    if (!id) throw new MetaApiError(502, null, "MetaApi did not return an account id");
    return { status: "CREATED", id };
  }

  getAccount(id: string): Promise<MetaApiAccount> {
    return this.json("GET", `${this.provisioning}/users/current/accounts/${enc(id)}`);
  }

  async deploy(id: string): Promise<void> {
    await this.call("POST", `${this.provisioning}/users/current/accounts/${enc(id)}/deploy`, {
      accept: [204],
    });
  }

  async undeploy(id: string): Promise<void> {
    await this.call("POST", `${this.provisioning}/users/current/accounts/${enc(id)}/undeploy`, {
      accept: [204],
    });
  }

  /** Removes the account and stops billing. An account already gone counts as removed. */
  async remove(id: string): Promise<void> {
    await this.call("DELETE", `${this.provisioning}/users/current/accounts/${enc(id)}`, {
      accept: [204, 404],
    });
  }

  // ─── Account data (regional host) ───

  async accountInformation(account: AccountRef): Promise<MetaApiAccountInformation> {
    return this.json("GET", `${await this.base(account)}/account-information`);
  }

  async positions(account: AccountRef): Promise<MetaApiPosition[]> {
    return (
      (await this.json<MetaApiPosition[] | null>("GET", `${await this.base(account)}/positions`)) ??
      []
    );
  }

  async symbolSpecification(
    account: AccountRef,
    symbol: string,
  ): Promise<MetaApiSymbolSpecification | null> {
    const res = await this.call(
      "GET",
      `${await this.base(account)}/symbols/${enc(symbol)}/specification`,
      { accept: [200, 404] },
    );
    return res.status === 404 ? null : (res.json as MetaApiSymbolSpecification);
  }

  /** Every deal in [start, end), paged. */
  async deals(account: AccountRef, start: Date, end: Date): Promise<MetaApiDeal[]> {
    const base = `${await this.base(account)}/history-deals/time/${enc(start.toISOString())}/${enc(end.toISOString())}`;
    const out: MetaApiDeal[] = [];
    for (let offset = 0; ; offset += DEALS_PAGE) {
      const page =
        (await this.json<MetaApiDeal[] | null>(
          "GET",
          `${base}?offset=${offset}&limit=${DEALS_PAGE}`,
        )) ?? [];
      out.push(...page);
      if (page.length < DEALS_PAGE) return out;
    }
  }

  // ─── Plumbing ───

  private async base(account: AccountRef): Promise<string> {
    const root = this.options.clientBaseUrl
      ? this.options.clientBaseUrl(account.region)
      : `https://mt-client-api-v1.${account.region}.${await this.clientDomain()}`;
    return `${root}/users/current/accounts/${enc(account.id)}`;
  }

  private clientDomain(): Promise<string> {
    this.domain ??= this.json<{ domain: string }>(
      "GET",
      `${this.provisioning}/users/current/servers/mt-client-api`,
    )
      .then((r) => r.domain)
      .catch((err: unknown) => {
        this.domain = undefined;
        throw err;
      });
    return this.domain;
  }

  private async json<T>(method: string, url: string): Promise<T> {
    return (await this.call(method, url, { accept: [200] })).json as T;
  }

  private async call(
    method: string,
    url: string,
    opts: { body?: unknown; headers?: Record<string, string>; accept: number[] },
  ): Promise<{ status: number; json: unknown; headers: Headers }> {
    if (!this.options.token) throw new MetaApiNotConfiguredError();
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method,
        headers: {
          "auth-token": this.options.token,
          ...(opts.body ? { "content-type": "application/json" } : {}),
          ...opts.headers,
        },
        ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new ExchangeNetworkError(err);
    }
    const text = await readCapped(res);
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // not JSON
    }
    if (opts.accept.includes(res.status)) return { status: res.status, json, headers: res.headers };
    throw toError(res, json);
  }
}

export interface AccountRef {
  id: string;
  region: string;
}

const enc = encodeURIComponent;

function retryAfter(res: { headers: Headers; json: unknown }): Date | null {
  const meta = (res.json as { metadata?: { recommendedRetryTime?: string } } | null)?.metadata;
  const raw = meta?.recommendedRetryTime ?? res.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  const d = Number.isFinite(seconds) ? new Date(Date.now() + seconds * 1000) : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** MetaApi errors: `details` is a code string (E_AUTH) or an object with `code` and suggestions. */
function toError(res: Response, json: unknown): MetaApiError {
  const body = (json ?? {}) as {
    error?: string;
    message?: string;
    details?: unknown;
    metadata?: { recommendedRetryTime?: string };
  };
  let code: string | null = body.error ?? null;
  let suggestions: string[] = [];
  if (typeof body.details === "string") code = body.details;
  else if (body.details && typeof body.details === "object") {
    const d = body.details as { code?: string; serversByBrokers?: Record<string, string[]> };
    code = d.code ?? code;
    suggestions = Object.values(d.serversByBrokers ?? {})
      .flat()
      .filter((s): s is string => typeof s === "string");
  }
  const retryAt = body.metadata?.recommendedRetryTime
    ? new Date(body.metadata.recommendedRetryTime)
    : null;
  return new MetaApiError(
    res.status,
    code,
    `MetaApi request failed (${res.status}${code ? `, ${code}` : ""})`,
    suggestions,
    retryAt && !Number.isNaN(retryAt.getTime()) ? retryAt : null,
  );
}
