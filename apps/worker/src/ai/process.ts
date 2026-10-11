import {
  AiRequestError,
  AiUnavailableError,
  type CoachDeps,
  CoachLimitError,
  ensureContext,
  reviewTrade,
  writeNote,
} from "@atc/coach";
import { ExchangeHttpError, ExchangeNetworkError } from "@atc/exchange-adapters";
import type { AiJobData, CoachNoteDto } from "@atc/shared";
import { log } from "../logger.js";

/** Thrown to make BullMQ retry later (rate limits, overload, network). */
export class RetryableAiError extends Error {}

/**
 * Runs one AI job. Permanent problems (no AI configured, plan limit, rejected request) end the job
 * quietly with the outcome recorded; temporary ones are rethrown so the queue retries with backoff.
 */
export async function processAiJob(
  deps: CoachDeps,
  data: AiJobData,
  onNote?: (userId: string, note: CoachNoteDto) => Promise<unknown>,
  opts: { finalAttempt?: boolean } = {},
): Promise<string> {
  try {
    switch (data.kind) {
      case "REVIEW_TRADE": {
        const review = await reviewTrade(deps, data.userId, data.positionId, {
          force: data.force,
          finalAttempt: opts.finalAttempt,
        });
        return review ? review.status : "SKIPPED";
      }
      case "MARKET_CONTEXT": {
        if (!deps.candles) return "UNAVAILABLE";
        const ctx = await ensureContext(deps.db, deps.candles, data.userId, data.positionId, {
          force: data.force,
        });
        return ctx ? "DONE" : "NO_HISTORY";
      }
      case "DAILY_NOTE": {
        const note = await writeNote(deps, data.userId, "DAILY", data.date);
        if (note) await onNote?.(data.userId, note);
        return note ? "DONE" : "NO_TRADES";
      }
      case "WEEKLY_NOTE":
        return (await writeNote(deps, data.userId, "WEEKLY", data.weekStart))
          ? "DONE"
          : "NO_TRADES";
    }
  } catch (err) {
    if (err instanceof AiUnavailableError) return "UNAVAILABLE";
    if (err instanceof CoachLimitError) return "LIMIT_REACHED";
    // Market data outages and rate limits: try again later.
    if (
      err instanceof ExchangeNetworkError ||
      (err instanceof ExchangeHttpError && (err.status === 429 || err.status >= 500))
    ) {
      throw new RetryableAiError(err.message);
    }
    if (err instanceof AiRequestError && err.retryable && !opts.finalAttempt) {
      log.warn("AI job will retry", { kind: data.kind, userId: data.userId, err });
      throw new RetryableAiError(err.message);
    }
    log.error("AI job failed", { kind: data.kind, userId: data.userId, err });
    return "FAILED";
  }
}
