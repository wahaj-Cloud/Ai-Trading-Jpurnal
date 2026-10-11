import { type NextRequest, NextResponse } from "next/server";
import { orderPicked, parseIds, stepHref } from "@/features/exchanges/queue";

/** Turns the picker's GET form (?x=BINANCE&x=KUCOIN) into the first step of the connect queue. */
export function GET(request: NextRequest): NextResponse {
  const order = orderPicked(parseIds(request.nextUrl.searchParams.getAll("x")));
  const first = order[0];
  const target = first ? stepHref(first, order, []) : "/exchanges/connect";
  return NextResponse.redirect(new URL(target, request.url), 303);
}
