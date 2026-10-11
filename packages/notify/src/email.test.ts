import { describe, expect, it } from "vitest";
import { EmailError, ResendSender, renderEmail } from "./email.js";

const APP = "https://app.example.com/";

describe("renderEmail", () => {
  it("escapes every user-influenced value", () => {
    const { html, text, subject } = renderEmail(
      { title: `<script>alert(1)</script>`, body: `a "quote" & <b>bold</b>`, link: "/trades/1" },
      APP,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;quote&quot; &amp; &lt;b&gt;");
    expect(subject).toBe("<script>alert(1)</script>");
    expect(text).toContain("https://app.example.com/trades/1");
  });

  it("only links into the app", () => {
    for (const link of ["https://evil.example/phish", "javascript:alert(1)", null]) {
      const { html } = renderEmail({ title: "t", body: "b", link }, APP);
      expect(html).toContain('href="https://app.example.com/dashboard"');
      expect(html).not.toContain("evil.example");
      expect(html).not.toContain("javascript:");
    }
    // Protocol-relative paths stay on our host (they become a path, never a new origin).
    const { html } = renderEmail({ title: "t", body: "b", link: "//evil.example" }, APP);
    expect(html).toContain('href="https://app.example.com//evil.example"');
  });

  it("keeps paragraphs and line breaks", () => {
    const { html } = renderEmail({ title: "t", body: "one\ntwo\n\nthree", link: null }, APP);
    expect(html).toContain("one<br>two</p>");
    expect(html).toContain(">three</p>");
  });
});

describe("ResendSender", () => {
  const message = { to: "a@b.io", subject: "s", html: "<p>h</p>", text: "h" };

  it("sends nothing without a key", async () => {
    let calls = 0;
    const s = new ResendSender({
      from: "x@y.io",
      fetch: (async () => {
        calls += 1;
        return new Response("{}");
      }) as typeof fetch,
    });
    expect(s.enabled).toBe(false);
    await s.send(message);
    expect(calls).toBe(0);
  });

  it("posts to Resend and classifies failures", async () => {
    let body: unknown;
    let status = 200;
    const s = new ResendSender({
      apiKey: "re_test",
      from: "Coach <x@y.io>",
      fetch: (async (_url: string, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return new Response("{}", { status });
      }) as typeof fetch,
    });
    await s.send(message);
    expect(body).toMatchObject({ from: "Coach <x@y.io>", to: ["a@b.io"], subject: "s" });

    status = 503;
    await expect(s.send(message)).rejects.toMatchObject({ retryable: true });
    status = 422;
    const err = await s.send(message).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailError);
    expect((err as EmailError).retryable).toBe(false);
  });
});
