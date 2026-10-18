import { DESK_DRIVER_INFO, type MarketDeskDto } from "@atc/shared";
import type { CoachModel } from "./model.js";

/**
 * The Market Context Desk's short AI summary. It only restates the measured drivers in plain words:
 * no calls, no predictions, no buy/sell language. Any answer that slips into signal wording is
 * thrown away rather than shown.
 */

export const DESK_SUMMARY_SYSTEM = `You write a 2–3 sentence market context note for a trading journal app.
You are given measured drivers for one market. Each driver already says which way its own evidence leans.

Rules:
- Describe what the drivers show, in plain English a beginner understands. Mention the most important 2–3 drivers and where they disagree.
- Never tell the reader to buy, sell, go long, go short, enter or exit. Never predict where price will go. Never give an overall verdict, a bias, a probability or a confidence level.
- Never use the words bullish, bearish, signal, buy, sell, or a percentage that sounds like a likelihood.
- If a high-impact release is coming within 24 hours, mention that volatility often rises around it.
- No greeting, no headings, no lists, no disclaimers (the app shows its own). Under 70 words.`;

const FORBIDDEN =
  /\b(bullish|bearish|signal|buy|sell|go long|go short|enter (a |the )?(long|short)|take profit|stop loss at|likely to (rise|fall)|will (rise|fall|go up|go down)|probability|confidence)\b/i;

export function deskSummaryInput(desk: Omit<MarketDeskDto, "summary" | "summaryAt">): string {
  const lines = [
    `Market: ${desk.name} (${desk.symbol}), price ${desk.price}, 24h change ${desk.change24hPct?.toFixed(2) ?? "n/a"}%.`,
    ...desk.drivers.map(
      (d) =>
        `${DESK_DRIVER_INFO[d.key].label} leans ${d.lean}: ${d.headline} ${d.evidence.join(" ")}`,
    ),
  ];
  if (desk.nextEvent) {
    const h = (Date.parse(desk.nextEvent.startsAt) - Date.parse(desk.computedAt)) / 3_600_000;
    lines.push(
      `Next high-impact release: ${desk.nextEvent.currency} ${desk.nextEvent.title} in ${h.toFixed(1)} hours.`,
    );
  }
  return lines.join("\n");
}

/** A neutral summary, or null when the AI is off, fails, or breaks the no-signal rule. */
export async function writeDeskSummary(
  model: CoachModel,
  desk: Omit<MarketDeskDto, "summary" | "summaryAt">,
): Promise<string | null> {
  if (!model.enabled || desk.drivers.length === 0) return null;
  const res = await model.complete({
    tier: "fast",
    system: DESK_SUMMARY_SYSTEM,
    messages: [{ role: "user", content: deskSummaryInput(desk) }],
    maxTokens: 220,
  });
  const text = res.text.replace(/\s+/g, " ").trim();
  if (!text || text.length > 700 || FORBIDDEN.test(text)) return null;
  return text;
}
