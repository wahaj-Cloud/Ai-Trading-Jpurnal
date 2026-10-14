import type { NextConfig } from "next";

/**
 * Clerk's frontend API host is encoded in the publishable key ("pk_live_" + base64("clerk.x.com$")).
 * Deriving it keeps the CSP exact for production custom domains without another setting.
 */
function clerkOrigin(): string | null {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  const encoded = key.split("_")[2];
  if (!encoded) return null;
  try {
    const host = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : null;
  } catch {
    return null;
  }
}
const clerk = ["https://*.clerk.accounts.dev", clerkOrigin()].filter(Boolean).join(" ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Payment is allowed only for Paddle's checkout frame (card wallets such as Apple Pay).
  {
    key: "Permissions-Policy",
    value:
      'camera=(), microphone=(), geolocation=(), payment=(self "https://buy.paddle.com" "https://sandbox-buy.paddle.com")',
  },
  // Report-only first: watch the browser console after deploying, then switch the key to
  // "Content-Security-Policy" to enforce (see docs/launch-hardening.md).
  {
    key: "Content-Security-Policy-Report-Only",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' ${clerk} https://cdn.paddle.com https://challenges.cloudflare.com https://s3.tradingview.com`,
      // Live Markets: browsers read Binance's public price feed directly (no keys, no server cost).
      `connect-src 'self' ${clerk} https://*.paddle.com https://fapi.binance.com wss://fstream.binance.com`,
      "img-src 'self' data: https://img.clerk.com",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "frame-src https://*.paddle.com https://challenges.cloudflare.com https://s.tradingview.com https://www.tradingview-widget.com",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@atc/shared", "@atc/ta"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
