import { describe, expect, it } from "vitest";
import { afterCurrent, buildQueue, orderPicked, parseIds, slugToExchange, stepHref } from "./queue";

describe("connect queue", () => {
  it("parses, upper-cases, de-duplicates and drops unknown exchanges", () => {
    expect(parseIds("kucoin,BINANCE,ftx,kucoin")).toEqual(["KUCOIN", "BINANCE"]);
    expect(parseIds(["BINGX", "mexc"])).toEqual(["BINGX", "MEXC"]);
    expect(parseIds(undefined)).toEqual([]);
  });

  it("orders picks the way the picker lists them", () => {
    expect(orderPicked(["BINGX", "BINANCE", "KUCOIN"])).toEqual(["BINANCE", "KUCOIN", "BINGX"]);
  });

  it("maps URL slugs to exchanges", () => {
    expect(slugToExchange("kucoin")).toBe("KUCOIN");
    expect(slugToExchange("../admin")).toBeNull();
  });

  it("walks the queue, recording connected exchanges", () => {
    const order = ["BINANCE", "KUCOIN", "BINGX"] as const;
    const first = buildQueue("BINANCE", order.join(","));
    expect(afterCurrent(first, true)).toBe(
      "/exchanges/connect/kucoin?q=BINANCE%2CKUCOIN%2CBINGX&done=BINANCE",
    );

    const second = buildQueue("KUCOIN", order.join(","), "BINANCE");
    expect(afterCurrent(second, false)).toBe(
      "/exchanges/connect/bingx?q=BINANCE%2CKUCOIN%2CBINGX&done=BINANCE",
    );

    const last = buildQueue("BINGX", order.join(","), "BINANCE");
    expect(afterCurrent(last, true)).toBe("/exchanges?connected=BINANCE,BINGX");
  });

  it("treats a tampered queue that omits the current exchange as a single step", () => {
    const q = buildQueue("MEXC", "BINANCE,KUCOIN", "MEXC,BINANCE");
    expect(q.order).toEqual(["MEXC"]);
    expect(q.done).toEqual(["BINANCE"]);
    expect(afterCurrent(q, true)).toBe("/exchanges?connected=BINANCE,MEXC");
  });

  it("builds a clean URL for a single exchange", () => {
    expect(stepHref("MEXC", ["MEXC"], [])).toBe("/exchanges/connect/mexc");
  });
});
