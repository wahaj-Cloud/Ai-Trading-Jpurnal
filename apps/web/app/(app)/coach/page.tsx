import type { ConversationDto } from "@atc/shared";
import { Plus } from "lucide-react";
import Link from "next/link";
import { getAnalytics } from "@/features/analytics/load";
import { Panel } from "@/features/analytics/metric";
import { CoachChat } from "@/features/coach/chat";
import { CoachDayButton } from "@/features/coach/coach-day-button";
import { Habits } from "@/features/coach/habits";
import {
  getBehaviour,
  getCoachStatus,
  getConversation,
  getConversations,
  getNotes,
} from "@/features/coach/load";
import { NoteCard } from "@/features/coach/note-card";
import { buildRecommendations } from "@/features/coach/recommendations";
import { RecommendationsList } from "@/features/coach/recommendations-card";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { getMe } from "@/lib/me";

export const metadata = { title: "AI Coach" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CoachPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; q?: string }>;
}) {
  const { c, q } = await searchParams;
  const question = q?.trim().slice(0, 2000) || undefined;
  const [status, conversations, notes, habits, me, report] = await Promise.all([
    getCoachStatus(),
    getConversations(),
    getNotes(3),
    getBehaviour(30),
    getMe(),
    getAnalytics("all").catch(() => null),
  ]);
  const recommendations = buildRecommendations(report, habits, 4);
  let conversation: ConversationDto | null = null;
  if (c && UUID.test(c)) {
    conversation = await getConversation(c).catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    });
  }
  const { usage } = status;
  const limitReached = usage.messagesLimit !== -1 && usage.messagesToday >= usage.messagesLimit;
  const disabledReason = !status.aiEnabled
    ? "The AI coach is not switched on for this app yet."
    : limitReached
      ? "You have used today's coach messages on your plan. They reset tomorrow."
      : null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: me.timezone }).format(new Date());

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Coach</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {usage.messagesLimit === -1
              ? "Unlimited questions on your plan."
              : `${Math.max(0, usage.messagesLimit - usage.messagesToday)} of ${usage.messagesLimit} questions left today.`}
          </p>
        </div>
        {status.aiEnabled && <CoachDayButton date={today} />}
      </header>

      <div className="grid gap-6 lg:grid-cols-[14rem_1fr] xl:grid-cols-[14rem_1fr_22rem]">
        <nav aria-label="Conversations" className="grid content-start gap-1">
          <Link
            href="/coach"
            className={cn(
              "flex h-9 items-center gap-2 rounded-[var(--radius-control)] px-3 text-sm",
              !conversation
                ? "bg-raised text-ink"
                : "text-ink-muted hover:bg-raised/60 hover:text-ink",
            )}
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> New conversation
          </Link>
          {conversations.map((cv) => (
            <Link
              key={cv.id}
              href={`/coach?c=${cv.id}`}
              aria-current={conversation?.id === cv.id ? "page" : undefined}
              className={cn(
                "truncate rounded-[var(--radius-control)] px-3 py-2 text-sm",
                conversation?.id === cv.id
                  ? "bg-raised text-ink"
                  : "text-ink-muted hover:bg-raised/60 hover:text-ink",
              )}
            >
              {cv.title}
            </Link>
          ))}
        </nav>

        <CoachChat
          key={conversation?.id ?? `new-${question ?? ""}`}
          conversation={conversation}
          disabledReason={disabledReason}
          initialQuestion={conversation ? undefined : question}
        />

        <div className="grid content-start gap-6 lg:col-span-2 xl:col-span-1">
          <Panel title="Recommended improvements">
            <RecommendationsList items={recommendations} />
          </Panel>
          <Panel title="Latest coaching">
            {notes.length ? (
              <div className="grid gap-6">
                {notes.map((n) => (
                  <NoteCard key={n.id} note={n} compact />
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-muted">
                Notes appear after each day with closed trades.
              </p>
            )}
          </Panel>
          <Panel title="Habits costing you money">
            <Habits summary={habits} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
