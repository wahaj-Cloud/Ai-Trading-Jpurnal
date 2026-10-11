/** Outgoing email. The provider sits behind this interface so tests and local runs send nothing. */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  readonly enabled: boolean;
  send(message: EmailMessage): Promise<void>;
}

export class EmailError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "EmailError";
  }
}

/** Resend (resend.com) transactional email API. */
export class ResendSender implements EmailSender {
  readonly enabled: boolean;
  constructor(
    private readonly opts: {
      apiKey?: string;
      from: string;
      fetch?: typeof fetch;
      baseUrl?: string;
    },
  ) {
    this.enabled = Boolean(opts.apiKey);
  }

  async send(m: EmailMessage): Promise<void> {
    if (!this.opts.apiKey) return;
    let res: Response;
    try {
      res = await (this.opts.fetch ?? fetch)(
        `${this.opts.baseUrl ?? "https://api.resend.com"}/emails`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.opts.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from: this.opts.from,
            to: [m.to],
            subject: m.subject,
            html: m.html,
            text: m.text,
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch (err) {
      throw new EmailError(`Email request failed: ${(err as Error).message}`, true);
    }
    if (!res.ok) {
      throw new EmailError(
        `Email rejected (${res.status})`,
        res.status === 429 || res.status >= 500,
      );
    }
  }
}

export class DisabledSender implements EmailSender {
  readonly enabled = false;
  async send(): Promise<void> {}
}

/** Records messages instead of sending (tests). */
export class MemorySender implements EmailSender {
  readonly enabled = true;
  readonly sent: EmailMessage[] = [];
  failNext: EmailError | null = null;
  async send(m: EmailMessage): Promise<void> {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    this.sent.push(m);
  }
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

/** A plain, accessible email: every value is escaped, links are absolute and point to our app only. */
export function renderEmail(
  n: { title: string; body: string; link: string | null },
  appUrl: string,
): { subject: string; html: string; text: string } {
  const base = appUrl.replace(/\/$/, "");
  const url = n.link?.startsWith("/") ? `${base}${n.link}` : `${base}/dashboard`;
  const settings = `${base}/settings#notifications`;
  const paragraphs = n.body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p).replaceAll("\n", "<br>")}</p>`)
    .join("");
  const html = `<!doctype html><html><body style="margin:0;background:#0f141c;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#e7ecf3">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
<p style="margin:0 0 20px;font-weight:600;color:#f0b429">AI Trading Coach</p>
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(n.title)}</h1>
<div style="font-size:15px;line-height:1.5;color:#c9d2de">${paragraphs}</div>
<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#f0b429;color:#1a1405;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600">Open in the app</a></p>
<p style="font-size:12px;color:#8c99ac">You receive this because of your notification settings. <a href="${escapeHtml(settings)}" style="color:#8c99ac">Change email preferences</a>.</p>
</div></body></html>`;
  const text = `${n.title}\n\n${n.body}\n\nOpen: ${url}\n\nChange email preferences: ${settings}`;
  return { subject: n.title, html, text };
}
