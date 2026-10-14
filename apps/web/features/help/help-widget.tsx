"use client";

import {
  HELP_SUGGESTIONS,
  type HelpAnswerDto,
  helpLink,
  looksLikeSecret,
  matchHelpTopic,
} from "@atc/shared";
import { ArrowUp, Bot, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { askHelpAction } from "./actions";

interface Msg {
  id: number;
  role: "user" | "assistant";
  content: string;
  links?: HelpAnswerDto["links"];
}

const GREETING =
  "Hello 👋 I'm the WickMentor help assistant. What can I help you with? Ask me anything about using the app.";
const SECRET_NOTE =
  "That looks like a password or API key, so I didn't send it. Please never share keys or passwords in chat.";
const SEEN_KEY = "wm-help-greeted";

/**
 * Floating help assistant, on every page. Answers "how do I…" questions about the app: common
 * ones instantly from the help topics, the rest from the AI with the help topics as its only
 * knowledge. It sees no account data, and the chat lives only in this tab.
 */
export function HelpWidget() {
  const [open, setOpen] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ id: 0, role: "assistant", content: GREETING }]);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const nextId = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // A one-time "Hi! Need help?" bubble per browser session.
  useEffect(() => {
    let seen = true;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
    } catch {
      /* storage blocked: skip the bubble */
    }
    if (seen) return;
    const t = setTimeout(() => setNudge(true), 2500);
    return () => clearTimeout(t);
  }, []);
  const dismissNudge = () => {
    setNudge(false);
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the list changes
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, pending]);

  const push = (m: Omit<Msg, "id">) => setMsgs((prev) => [...prev, { ...m, id: nextId.current++ }]);

  function ask(raw: string) {
    const question = raw.trim().slice(0, 500);
    if (!question || pending) return;
    setText("");
    if (looksLikeSecret(question)) {
      push({ role: "assistant", content: SECRET_NOTE });
      return;
    }
    push({ role: "user", content: question });
    const asked = msgs.filter((m) => m.role === "user").length;
    // First question with a clear match: answer instantly, no AI needed.
    const topic = asked === 0 ? matchHelpTopic(question) : null;
    if (topic) {
      const link = helpLink(topic);
      push({ role: "assistant", content: topic.answer, links: link ? [link] : [] });
      return;
    }
    const history = msgs
      .slice(1)
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));
    start(async () => {
      const res = await askHelpAction({ question, history });
      push({ role: "assistant", content: res.answer, links: res.links });
    });
  }

  const onlyGreeting = msgs.length === 1;

  return (
    <div className="fixed right-4 bottom-[calc(6.25rem+env(safe-area-inset-bottom))] z-40 flex flex-col items-end gap-3 lg:right-6 lg:bottom-6">
      {open && (
        <section
          role="dialog"
          aria-label="Help assistant"
          className="flex h-[min(34rem,calc(100dvh-10rem))] border border-rule bg-sheet w-[min(23rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-[var(--radius-surface)] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.75)]"
        >
          <header className="flex items-center gap-3 border-b border-rule px-4 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-coach text-coach-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
              <Bot className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">WickMentor Help</h2>
              <p className="flex items-center gap-1 text-[11px] text-ink-faint">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                About using the app · never share passwords or keys
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-hi/[0.08] hover:text-ink"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Close help</span>
            </button>
          </header>

          <div
            ref={listRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
            aria-live="polite"
          >
            {msgs.map((m) => (
              <div
                key={m.id}
                className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    m.role === "user"
                      ? "rounded-br-md bg-coach text-coach-ink"
                      : "raised rounded-bl-md text-ink",
                  )}
                >
                  <p className="whitespace-pre-wrap">{m.content}</p>
                  {m.links && m.links.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.links.map((l) => (
                        <Link
                          key={l.href}
                          href={l.href}
                          onClick={() => setOpen(false)}
                          className="rounded-full border border-coach/50 px-2.5 py-0.5 text-xs font-medium text-coach hover:bg-coach/10"
                        >
                          {l.label} →
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {pending && (
              <div className="flex justify-start">
                <div className="raised flex gap-1 rounded-2xl rounded-bl-md px-3.5 py-3">
                  <span className="sr-only">Thinking</span>
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-muted"
                      style={{ animationDelay: `${i * 120}ms` }}
                    />
                  ))}
                </div>
              </div>
            )}
            {onlyGreeting && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {HELP_SUGGESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => ask(q)}
                    className="rounded-full border border-rule px-3 py-1 text-xs text-ink-muted hover:border-coach/60 hover:text-ink"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form
            className="flex items-end gap-2 border-t border-rule p-3"
            onSubmit={(e) => {
              e.preventDefault();
              ask(text);
            }}
          >
            <label htmlFor="help-input" className="sr-only">
              Ask a question about WickMentor
            </label>
            <textarea
              id="help-input"
              ref={inputRef}
              rows={1}
              value={text}
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(text);
                }
              }}
              placeholder="Ask how to do something…"
              className="max-h-28 min-h-10 flex-1 resize-none rounded-[var(--radius-control)] border border-rule bg-well px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-coach"
            />
            <button
              type="submit"
              disabled={!text.trim() || pending}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-coach text-coach-ink transition-opacity disabled:opacity-40"
            >
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Send</span>
            </button>
          </form>
        </section>
      )}

      {!open && nudge && (
        <div className="relative flex max-w-[15rem] border border-rule bg-sheet items-start gap-2 rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm shadow-lg">
          <button
            type="button"
            className="text-left"
            onClick={() => {
              dismissNudge();
              setOpen(true);
            }}
          >
            Hi! 👋 Need help with WickMentor?
          </button>
          <button
            type="button"
            onClick={dismissNudge}
            className="-mr-1 text-ink-faint hover:text-ink"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Dismiss</span>
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          dismissNudge();
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="pop flex h-14 w-14 items-center justify-center rounded-full bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-coach)_75%,white),var(--color-coach))] text-coach-ink shadow-[0_12px_30px_-8px_var(--color-coach)] transition-transform hover:scale-105"
      >
        {open ? (
          <X className="h-6 w-6" aria-hidden="true" />
        ) : (
          <Bot className="h-6 w-6" aria-hidden="true" />
        )}
        <span className="sr-only">{open ? "Close help" : "Open help assistant"}</span>
      </button>
    </div>
  );
}
