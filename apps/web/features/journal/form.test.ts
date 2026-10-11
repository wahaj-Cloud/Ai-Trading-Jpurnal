import { journalInputSchema } from "@atc/shared";
import { describe, expect, it } from "vitest";
import { journalFromForm } from "./form";

describe("journalFromForm", () => {
  it("maps form fields to a valid journal entry", () => {
    const f = new FormData();
    f.set("rating", "4");
    f.set("setup", " Breakout ");
    f.set("tags", "news, a+ ,");
    f.append("emotions", "CALM");
    f.append("mistakes", "CHASED_ENTRY");
    f.set("stopPrice", "61000");
    f.set("targetPrice", "");
    f.set("notes", "  ");
    f.set("screenshotUrls", "https://a.io/1\n https://b.io/2 ");
    const parsed = journalInputSchema.parse(journalFromForm(f));
    expect(parsed).toMatchObject({
      rating: 4,
      setup: "Breakout",
      tags: ["news", "a+"],
      emotions: ["CALM"],
      mistakes: ["CHASED_ENTRY"],
      stopPrice: "61000",
      targetPrice: null,
      notes: null,
      screenshotUrls: ["https://a.io/1", "https://b.io/2"],
    });
  });

  it("an empty form clears the entry", () => {
    expect(journalInputSchema.parse(journalFromForm(new FormData()))).toMatchObject({
      rating: null,
      tags: [],
      screenshotUrls: [],
    });
  });

  it("a fifth screenshot link is reported, not silently dropped", () => {
    const f = new FormData();
    f.set("screenshotUrls", Array.from({ length: 6 }, (_, i) => `https://a.io/${i}`).join("\n"));
    expect(journalInputSchema.safeParse(journalFromForm(f)).success).toBe(false);
  });
});
