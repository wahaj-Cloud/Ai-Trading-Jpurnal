import type {
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import { formatCountdown } from "./geometry";

/**
 * TradingView-style candle countdown: a second label on the price axis, just under the last price,
 * showing the time left until the current candle closes. Ticks once a second on its own.
 */
export class CountdownPrimitive implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closeTime = 0;
  private price: number | null = null;
  private color = "#26b07e";
  private visible = true;
  private readonly views: readonly ISeriesPrimitiveAxisView[];

  constructor() {
    this.views = [
      {
        // Pinned right under the last-price label, like TradingView (other labels make room).
        coordinate: () => -10_000,
        fixedCoordinate: () => {
          const y = this.price === null ? null : this.series?.priceToCoordinate(this.price);
          return y === null || y === undefined ? undefined : y + 17;
        },
        text: () => formatCountdown(this.closeTime - Date.now()),
        textColor: () => "#ffffff",
        backColor: () => this.color,
        visible: () => this.visible && this.price !== null && this.closeTime > 0,
        tickVisible: () => false,
      },
    ];
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.series = p.series;
    this.requestUpdate = p.requestUpdate;
    this.timer = setInterval(() => this.requestUpdate?.(), 1000);
  }

  detached(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.series = null;
    this.requestUpdate = null;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.views;
  }

  /** `closeTime` is the candle's last millisecond, as Binance reports it. */
  set(state: { closeTime: number; price: number; color: string; visible: boolean }): void {
    this.closeTime = state.closeTime + 1;
    this.price = state.price;
    this.color = state.color;
    this.visible = state.visible;
  }
}
