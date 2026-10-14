import type { PrismaClient } from "@atc/db";
import { describe, expect, it, vi } from "vitest";
import { answerHelp } from "./help.js";
import type { CoachModel } from "./model.js";

function setup(enabled = true) {
  const executed: unknown[] = [];
  const db = {
    $queryRaw: vi.fn(async () => [{ count: 1 }]),
    $executeRaw: vi.fn(async (...args: unknown[]) => {
      executed.push(args);
      return 1;
    }),
  } as unknown as PrismaClient;
  const complete = vi.fn(async (_req: unknown) => ({
    text: "Open Settings and pick your currency.",
    toolInput: null,
    model: "claude-haiku-4-5-20251001",
    inputTokens: 2000,
    outputTokens: 100,
  }));
  const model: CoachModel = { enabled, complete };
  return { deps: { db, model }, complete, executed };
}

describe("help assistant", () => {
  it("refuses secrets without calling the AI", async () => {
    const { deps, complete } = setup();
    const out = await answerHelp(deps, "u1", {
      question: "here is my key vmPUZE6mv9SD5VNHk4HlWFsOr6aKE2zvsw0MuIgwCIPy",
      history: [],
    });
    expect(out.answer).toMatch(/don't share/i);
    expect(complete).not.toHaveBeenCalled();
  });

  it("answers known topics instantly and for free", async () => {
    const { deps, complete } = setup();
    const out = await answerHelp(deps, "u1", {
      question: "how to export a pdf report",
      history: [],
    });
    expect(out.links[0]?.href).toBe("/reports");
    expect(complete).not.toHaveBeenCalled();
  });

  it("asks the fast model for other questions and records the cost", async () => {
    const { deps, complete, executed } = setup();
    const out = await answerHelp(deps, "u1", {
      question: "can my friend see my journal if I share my screen?",
      history: [],
    });
    expect(out.answer).toMatch(/Settings/);
    const req = complete.mock.calls[0]?.[0] as { tier: string; system: string };
    expect(req.tier).toBe("fast");
    expect(req.system).toContain("<knowledge>");
    expect(executed).toHaveLength(1);
  });

  it("falls back to the help page when the AI is off", async () => {
    const { deps } = setup(false);
    const out = await answerHelp(deps, "u1", { question: "something unusual here", history: [] });
    expect(out.links.map((l) => l.href)).toContain("/help");
  });
});
