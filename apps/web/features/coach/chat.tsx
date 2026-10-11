"use client";

import {
  COACH_MESSAGE_MAX,
  COACH_SUGGESTIONS,
  type CoachMessageDto,
  type ConversationDto,
} from "@atc/shared";
import { ArrowUp, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { sendChatAction } from "./actions";
import { MessageText } from "./message-text";

export function CoachChat({
  conversation,
  disabledReason,
}: {
  conversation: ConversationDto | null;
  /** Set when the coach cannot answer (AI off or daily limit used). */
  disabledReason: string | null;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<CoachMessageDto[]>(conversation?.messages ?? []);
  const [conversationId, setConversationId] = useState(conversation?.id);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(conversation?.messages ?? []);
    setConversationId(conversation?.id);
  }, [conversation]);
  // Keep the newest message (or the "thinking" line) in view.
  const scrollKey = `${messages.length}-${pending}`;
  useEffect(() => {
    if (scrollKey) end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [scrollKey]);

  const send = (text: string) => {
    const message = text.trim();
    if (!message || pending) return;
    setError(null);
    setDraft("");
    const optimistic: CoachMessageDto = {
      id: `local-${Date.now()}`,
      role: "USER",
      content: message,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    start(async () => {
      const res = await sendChatAction({ conversationId, message });
      if (res.conversation) {
        setMessages(res.conversation.messages);
        if (res.conversation.id !== conversationId) {
          setConversationId(res.conversation.id);
          router.replace(`/coach?c=${res.conversation.id}`, { scroll: false });
        }
        router.refresh();
      } else {
        setMessages((m) => m.filter((x) => x.id !== optimistic.id));
        setDraft(message);
        setError(res.error ?? "Something went wrong.");
      }
    });
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };

  return (
    <div className="flex min-h-[60vh] flex-col rounded-[var(--radius-surface)] border border-rule bg-panel">
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" aria-live="polite">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-lg py-8 text-center">
            <Sparkles className="mx-auto h-6 w-6 text-coach" aria-hidden="true" />
            <h2 className="mt-3 font-semibold">Ask your coach</h2>
            <p className="mt-2 text-sm text-ink-muted">
              Answers come from your own synced trades, journal and coaching notes.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {COACH_SUGGESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={Boolean(disabledReason) || pending}
                  onClick={() => send(q)}
                  className="rounded-full border border-rule px-3 py-1.5 text-sm text-ink-muted hover:border-coach hover:text-ink disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={cn("flex", m.role === "USER" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-[var(--radius-surface)] px-4 py-3 text-sm",
                  m.role === "USER"
                    ? "bg-raised text-ink"
                    : "border border-rule bg-canvas/50 text-ink",
                )}
              >
                {m.role === "ASSISTANT" ? (
                  <MessageText text={m.content} />
                ) : (
                  <p className="whitespace-pre-line">{m.content}</p>
                )}
              </div>
            </div>
          ))
        )}
        {pending && (
          <p className="text-sm text-coach" role="status">
            Your coach is looking at your trades…
          </p>
        )}
        <div ref={end} />
      </div>

      <form onSubmit={onSubmit} className="border-t border-rule p-3 sm:p-4">
        {(error || disabledReason) && (
          <p role="alert" className="mb-2 text-sm text-loss">
            {error ?? disabledReason}
          </p>
        )}
        <div className="flex items-end gap-2">
          <label htmlFor="coach-input" className="sr-only">
            Message your coach
          </label>
          <textarea
            id="coach-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            rows={1}
            maxLength={COACH_MESSAGE_MAX}
            disabled={Boolean(disabledReason)}
            placeholder={disabledReason ? "" : "Ask about your trading…"}
            className="max-h-40 min-h-10 flex-1 resize-y rounded-[var(--radius-control)] border border-rule bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-coach focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={pending || !draft.trim() || Boolean(disabledReason)}
            aria-label="Send"
            className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] bg-coach text-coach-ink disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">
          Coaching on your own process, not financial advice. The coach can make mistakes; check the
          numbers in Analytics.
        </p>
      </form>
    </div>
  );
}
