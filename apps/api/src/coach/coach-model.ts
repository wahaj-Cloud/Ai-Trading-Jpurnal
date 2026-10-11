import { AnthropicModel, type CoachModel } from "@atc/coach";
import type { Env } from "../config/env.js";

export const COACH_MODEL = Symbol("COACH_MODEL");

export function createCoachModel(env: Env): CoachModel {
  return new AnthropicModel({
    apiKey: env.ANTHROPIC_API_KEY,
    baseUrl: env.ANTHROPIC_BASE_URL,
    fastModel: env.AI_FAST_MODEL,
    smartModel: env.AI_SMART_MODEL,
  });
}
