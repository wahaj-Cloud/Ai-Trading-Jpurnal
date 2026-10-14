import { describe, expect, it } from "vitest";
import { HELP_TOPICS, looksLikeSecret, matchHelpTopic } from "./help.js";

describe("help topics", () => {
  it("answers common questions without the AI", () => {
    expect(matchHelpTopic("how do i connect binance")?.id).toBe("connect-exchange");
    expect(matchHelpTopic("change currency to PKR")?.id).toBe("currency");
    expect(matchHelpTopic("export pdf report")?.id).toBe("reports");
    expect(matchHelpTopic("exness investor password")?.id).toBe("exness");
  });
  it("leaves unclear questions to the assistant", () => {
    expect(matchHelpTopic("hello")).toBeNull();
    expect(matchHelpTopic("why is the sky blue today")).toBeNull();
  });
  it("has unique ids", () => {
    expect(new Set(HELP_TOPICS.map((t) => t.id)).size).toBe(HELP_TOPICS.length);
  });
});

describe("secret detection", () => {
  it("flags keys and passwords", () => {
    expect(
      looksLikeSecret("my key is vmPUZE6mv9SD5VNHk4HlWFsOr6aKE2zvsw0MuIgwCIPy6utIco14y8Ju79Nd"),
    ).toBe(true);
    expect(looksLikeSecret("password: hunter22")).toBe(true);
  });
  it("lets normal questions through", () => {
    expect(looksLikeSecret("How do I connect my Exness-MT5Real8 account?")).toBe(false);
    expect(looksLikeSecret("what is my investor password used for")).toBe(false);
  });
});
