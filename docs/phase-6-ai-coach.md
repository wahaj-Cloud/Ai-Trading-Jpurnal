# Phase 6 — AI trading coach

## Purpose
Turn the journal into a coach: every closed trade gets a grade and written review, each trading day
and week gets a coaching note, and traders can chat with a coach that knows their own numbers.

## Architecture
- `packages/coach`
  - `behaviour.ts` — deterministic detectors: FOMO, revenge trading, over-trading, holding losers,
    early profit-taking, oversized risk, trading after daily loss limit, and more.
  - `grade.ts` — rules-based grade (A+ … F) from risk, execution and behaviour flags. The AI never
    invents the grade.
  - `model.ts` — `CoachModel` interface. `AnthropicModel` uses forced tool output and prompt caching;
    `FakeModel` is for tests.
  - `prompts.ts` — versioned prompts with zod output schemas.
  - `facts.ts` — the fact sheet sent to the model; journal notes are fenced as data.
  - `data.ts` — plan limits (effective plan), atomic usage reservation, history window.
  - `service.ts` — review trade, daily/weekly notes, chat, status.
- Worker (`ai-coach` queue): automatically reviews trades closed in the last 48 hours after each
  sync, and writes daily/weekly notes on a 15-minute scheduler in each user's timezone.
- Web: `/coach` (chat, notes, habits), `/journal` (reviewed trades), a review panel on the trade page
  and a coach panel on the dashboard.

## Database changes
Migration `20261002000000_ai_coach`: `trade_reviews`, `coach_notes`, `coach_conversations`,
`coach_messages`.

## API endpoints
`GET /v1/coach/status|behaviour|notes|reviews|strategy|conversations|conversations/:id`,
`DELETE /v1/coach/conversations/:id`, `POST /v1/coach/chat`, `POST /v1/coach/notes/daily`,
`POST /v1/positions/:id/review`.

## Configuration
`ANTHROPIC_API_KEY` (API and worker), `AI_FAST_MODEL`, `AI_SMART_MODEL`, `AI_CONCURRENCY` (worker).
Without a key, AI text is off; grades, behaviour flags and strategy insights still work.

## Future improvements
Streaming chat responses; screenshot (vision) review of the chart; per-user coaching memory.
