import { describe, expect, it } from "vitest";
import { fakeExchange } from "../test-utils.js";
import {
  CENTRAL_BANK_FEEDS,
  fetchCentralBankFeed,
  fetchFinnhubNews,
  fetchGdelt,
  parseFeed,
  parseGdelt,
  parseGdeltDate,
  parseTradingEconomicsNews,
} from "./news-sources.js";

describe("Finnhub market news", () => {
  it("reads the documented fields and sends the key as a parameter", async () => {
    const ex = fakeExchange((url) =>
      url.pathname === "/api/v1/news"
        ? {
            body: [
              {
                category: "top news",
                datetime: 1792325400,
                headline: "  Fed holds rates steady,\n signals patience ",
                id: 7412345,
                image: "https://x/i.jpg",
                related: "",
                source: "Reuters",
                summary: "The Federal Reserve left rates unchanged.",
                url: "https://www.reuters.com/markets/fed",
              },
              { id: "x", datetime: 0, headline: "" },
            ],
          }
        : undefined,
    );
    const items = await fetchFinnhubNews(
      { fetch: ex.fetch, apiKey: "k".repeat(20) },
      "general",
      7412000,
    );
    expect(items).toEqual([
      {
        source: "FINNHUB",
        sourceId: "7412345",
        title: "Fed holds rates steady, signals patience",
        summary: "The Federal Reserve left rates unchanged.",
        url: "https://www.reuters.com/markets/fed",
        publisher: "Reuters",
        publishedAt: 1792325400000,
        sourceCategory: "general",
        importance: null,
        monetaryPolicy: false,
      },
    ]);
    const q = ex.requests[0]?.url.searchParams;
    expect(q?.get("category")).toBe("general");
    expect(q?.get("minId")).toBe("7412000");
    expect(q?.get("token")).toHaveLength(20);
  });
});

const FED_RSS = `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>FRB</title>
<item><title><![CDATA[Federal Reserve issues FOMC statement]]></title><link>https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm</link>
<guid isPermaLink="true">https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm</guid>
<description><![CDATA[<p>Recent indicators suggest &amp; growth has moderated.</p>]]></description>
<pubDate>Wed, 16 Sep 2026 18:00:00 GMT</pubDate></item>
<item><title>No date here</title><link>https://x</link></item>
</channel></rss>`;

const ECB_RSS = `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<item><title> Monetary policy decisions </title><link>https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.mp260910.en.html</link>
<guid>https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.mp260910.en.html</guid><pubDate>Thu, 10 Sep 2026 14:15:00 +0200</pubDate></item>
<item><title>Christine Lagarde: Interview with Ouest-France</title><link>https://www.ecb.europa.eu/press/inter/x.en.html</link>
<guid>https://www.ecb.europa.eu/press/inter/x.en.html</guid><pubDate>Wed, 16 Sep 2026 10:00:00 +0200</pubDate></item>
</channel></rss>`;

describe("central-bank feeds", () => {
  it("parses the Federal Reserve feed, decoding CDATA, tags and entities", () => {
    const [fomc, ...rest] = parseFeed(FED_RSS, "FED", "Federal Reserve", {
      monetaryPolicy: () => true,
    });
    expect(rest).toHaveLength(0);
    expect(fomc).toMatchObject({
      source: "FED",
      title: "Federal Reserve issues FOMC statement",
      summary: "Recent indicators suggest & growth has moderated.",
      publishedAt: Date.UTC(2026, 8, 16, 18),
      monetaryPolicy: true,
      sourceId: "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm",
    });
  });

  it("flags ECB policy decisions only, with time zones honoured", async () => {
    const ex = fakeExchange((url) =>
      url.host === "www.ecb.europa.eu" ? { body: ECB_RSS } : undefined,
    );
    // fakeExchange sends JSON; the feed text arrives as a JSON string, so unwrap it.
    const raw = (async (input: string | URL | Request, init?: RequestInit) => {
      const r = await ex.fetch(input, init);
      return new Response(JSON.parse(await r.text()), { status: r.status });
    }) as typeof fetch;
    const feed = CENTRAL_BANK_FEEDS.find((f) => f.source === "ECB");
    if (!feed) throw new Error("no ECB feed");
    const items = await fetchCentralBankFeed({ fetch: raw }, feed);
    expect(items.map((i) => [i.title, i.monetaryPolicy])).toEqual([
      ["Monetary policy decisions", true],
      ["Christine Lagarde: Interview with Ouest-France", false],
    ]);
    expect(items[0]?.publishedAt).toBe(Date.UTC(2026, 8, 10, 12, 15));
  });

  it("reads Atom entries too", () => {
    const atom = `<feed><entry><title>Rate decision</title><link href="https://bank.example/a"/><id>tag:a</id><updated>2026-09-16T18:00:00Z</updated><summary>Text</summary></entry></feed>`;
    expect(parseFeed(atom, "FED", "X")[0]).toMatchObject({
      sourceId: "tag:a",
      url: "https://bank.example/a",
      publishedAt: Date.UTC(2026, 8, 16, 18),
      summary: "Text",
    });
  });
});

describe("GDELT", () => {
  it("keeps well-known newsrooms in English and parses seendate", () => {
    const items = parseGdelt({
      articles: [
        {
          url: "https://www.reuters.com/world/x",
          title: "Missiles hit port city",
          seendate: "20261018T121500Z",
          domain: "reuters.com",
          language: "English",
          sourcecountry: "United States",
        },
        {
          url: "https://smallblog.example/y",
          title: "War rumours",
          seendate: "20261018T121500Z",
          domain: "smallblog.example",
          language: "English",
        },
        {
          url: "https://www.bbc.com/z",
          title: "Guerre",
          seendate: "20261018T121500Z",
          domain: "bbc.com",
          language: "French",
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: "GDELT",
      publisher: "reuters.com",
      publishedAt: Date.UTC(2026, 9, 18, 12, 15),
    });
    expect(parseGdeltDate("bad")).toBeNaN();
  });

  it("asks for newest-first article lists and survives a plain-text error", async () => {
    const ex = fakeExchange(() => ({ body: { articles: [] } }));
    await fetchGdelt({ fetch: ex.fetch }, "15min");
    const q = ex.requests[0]?.url.searchParams;
    expect([q?.get("mode"), q?.get("format"), q?.get("sort"), q?.get("timespan")]).toEqual([
      "ArtList",
      "json",
      "datedesc",
      "15min",
    ]);
    const text = (async () =>
      new Response("Please limit requests to one every 5 seconds")) as unknown as typeof fetch;
    expect(await fetchGdelt({ fetch: text })).toEqual([]);
  });
});

describe("Trading Economics news stream", () => {
  it("reads news messages with importance and ignores other topics", () => {
    const h = parseTradingEconomicsNews({
      topic: "news",
      title: "US Inflation Rate Rises More Than Expected",
      description: "Annual inflation rose to 3.4%.",
      url: "/united-states/inflation-cpi",
      importance: 3,
      category: "Inflation Rate",
      country: "United States",
      date: "2026-10-15T12:30:05",
      id: "412345",
    });
    expect(h).toMatchObject({
      sourceId: "412345",
      url: "https://tradingeconomics.com/united-states/inflation-cpi",
      importance: 3,
      publishedAt: Date.UTC(2026, 9, 15, 12, 30, 5),
    });
    expect(parseTradingEconomicsNews({ topic: "calendar", title: "x" })).toBeNull();
  });
});
