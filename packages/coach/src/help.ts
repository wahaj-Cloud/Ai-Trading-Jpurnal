import type { PrismaClient } from "@atc/db";
import {
  HELP_TOPICS,
  type HelpAnswerDto,
  type HelpAskInput,
  helpLink,
  looksLikeSecret,
  matchHelpTopic,
} from "@atc/shared";
import { reserveUsage } from "./data.js";
import type { CoachModel } from "./model.js";
import { recordAiCost } from "./service.js";

/** Questions a user may send to the AI help assistant per UTC day (instant answers are free). */
export const HELP_QUESTIONS_PER_DAY = 30;
const METRIC_HELP = "help_question";

const KNOWLEDGE = HELP_TOPICS.map((t) => `Q: ${t.question}\nA: ${t.answer}`).join("\n\n");

export const HELP_SYSTEM = `You are the in-app help assistant of WickMentor, an AI trading journal and coach for crypto futures and forex traders.

Your only job: explain how to use WickMentor (pages, settings, connecting exchanges, plans, features).
Rules:
- Answer in 1–4 short sentences, plain language, friendly. Use the user's language if they write in another language (e.g. Urdu or Roman Urdu).
- Use ONLY the knowledge below. If the answer is not there, say you are not sure and suggest the Help page or contacting support. Never invent features, prices or steps.
- You cannot see the user's account, trades or settings. For questions about their own results ("why did I lose", "how am I doing"), tell them to ask the AI Coach page.
- Never ask for, repeat or accept passwords, API keys, secrets, card numbers or other personal information. If the user shares one, tell them to remove it and, for a key, to delete it on the exchange and create a new read-only one.
- No trading signals, price predictions or financial advice.

<knowledge>
${KNOWLEDGE}
</knowledge>`;

const SECRET_WARNING =
  "Please don't share API keys, secrets or passwords in chat — I don't need them. If you pasted a real key, delete it on the exchange and create a new read-only one, then connect it on the Exchanges page.";

export interface HelpDeps {
  db: PrismaClient;
  model: CoachModel;
  now?: () => Date;
}

/**
 * Answers a "how do I use the app" question. Instant answers from the help topics are free; other
 * questions go to the fast model with the help topics as its only knowledge. Nothing about the
 * user is sent, and the conversation is not stored.
 */
export async function answerHelp(
  deps: HelpDeps,
  userId: string,
  input: HelpAskInput,
): Promise<HelpAnswerDto> {
  const { question, history } = input;
  if (looksLikeSecret(question)) return { answer: SECRET_WARNING, links: [] };

  const topic = matchHelpTopic(question);
  const link = topic ? helpLink(topic) : null;
  if (topic && history.length === 0) return { answer: topic.answer, links: link ? [link] : [] };

  const fallback: HelpAnswerDto = {
    answer:
      "I'm not sure about that one. The Help page explains every number and screen, or ask the AI Coach about your own trading.",
    links: [
      { label: "Help", href: "/help" },
      { label: "AI Coach", href: "/coach" },
    ],
  };
  if (!deps.model.enabled)
    return topic ? { answer: topic.answer, links: link ? [link] : [] } : fallback;

  const now = deps.now?.() ?? new Date();
  const iso = now.toISOString();
  if (
    !(await reserveUsage(deps.db, userId, METRIC_HELP, iso.slice(0, 10), HELP_QUESTIONS_PER_DAY))
  ) {
    return {
      answer: `You've asked the help assistant ${HELP_QUESTIONS_PER_DAY} questions today. The Help page has every answer, and the assistant is back tomorrow.`,
      links: [{ label: "Help", href: "/help" }],
    };
  }
  const res = await deps.model.complete({
    tier: "fast",
    system: HELP_SYSTEM,
    messages: [
      ...history.filter((m) => !looksLikeSecret(m.content)),
      { role: "user", content: question },
    ],
    maxTokens: 350,
  });
  await recordAiCost(deps.db, userId, iso.slice(0, 7), res);
  const answer = res.text.trim();
  const related = topic ?? matchHelpTopic(`${question} ${answer}`, 0.35);
  const relatedLink = related ? helpLink(related) : null;
  return answer ? { answer, links: relatedLink ? [relatedLink] : [] } : fallback;
}
