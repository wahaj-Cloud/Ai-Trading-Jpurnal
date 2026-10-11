/**
 * The language-model boundary. Everything the coach sends to a model goes through this interface,
 * so the provider can change and tests run without network access.
 */
export interface ModelMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ModelTool {
  name: string;
  description: string;
  /** JSON Schema of the tool input. */
  schema: Record<string, unknown>;
}

export interface ModelRequest {
  /** "fast" for high-volume structured work (reviews, notes), "smart" for conversation. */
  tier: "fast" | "smart";
  system: string;
  messages: ModelMessage[];
  maxTokens: number;
  /** When set, the model must answer by calling this tool (structured output). */
  tool?: ModelTool;
}

export interface ModelResponse {
  text: string;
  toolInput: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface CoachModel {
  readonly enabled: boolean;
  complete(req: ModelRequest): Promise<ModelResponse>;
}

export class AiUnavailableError extends Error {
  constructor(message = "AI coaching is not configured") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export class AiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Rate limits, overload and network failures are worth retrying later. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AiRequestError";
  }
}

export interface AnthropicOptions {
  apiKey?: string;
  fastModel: string;
  smartModel: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** Claude via the Messages API (plain fetch: no SDK needed for the few features we use). */
export class AnthropicModel implements CoachModel {
  readonly enabled: boolean;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: AnthropicOptions) {
    this.enabled = Boolean(opts.apiKey);
    this.fetchFn = opts.fetch ?? fetch;
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    if (!this.opts.apiKey) throw new AiUnavailableError();
    const model = req.tier === "fast" ? this.opts.fastModel : this.opts.smartModel;
    const body: Record<string, unknown> = {
      model,
      max_tokens: req.maxTokens,
      // The instructions are identical for every call of a kind: cache them.
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: req.messages,
    };
    if (req.tool) {
      body.tools = [
        { name: req.tool.name, description: req.tool.description, input_schema: req.tool.schema },
      ];
      body.tool_choice = { type: "tool", name: req.tool.name };
    }

    let res: Response;
    try {
      res = await this.fetchFn(`${this.opts.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.opts.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 60_000),
      });
    } catch (err) {
      throw new AiRequestError(0, `AI request failed: ${(err as Error).message}`, true);
    }
    const json = (await res.json().catch(() => null)) as AnthropicResponse | null;
    if (!res.ok || !json) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new AiRequestError(
        res.status,
        `AI request failed (${res.status}): ${json?.error?.message ?? "no details"}`,
        retryable,
      );
    }
    const text = json.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    const tool = json.content.find((b) => b.type === "tool_use");
    return {
      text,
      toolInput: tool?.input ?? null,
      model: json.model ?? model,
      inputTokens:
        (json.usage?.input_tokens ?? 0) +
        (json.usage?.cache_read_input_tokens ?? 0) +
        (json.usage?.cache_creation_input_tokens ?? 0),
      outputTokens: json.usage?.output_tokens ?? 0,
    };
  }
}

interface AnthropicResponse {
  model?: string;
  content: { type: string; text?: string; input?: unknown }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  error?: { message?: string };
}

/**
 * Deterministic stand-in for tests and local development: answers every tool call with the
 * provided generator and every chat message with a fixed reply.
 */
export class FakeModel implements CoachModel {
  readonly enabled = true;
  readonly calls: ModelRequest[] = [];
  constructor(
    private readonly answer: (req: ModelRequest) => {
      text?: string;
      toolInput?: unknown;
    } = () => ({
      text: "Fake coach reply.",
    }),
  ) {}

  async complete(req: ModelRequest): Promise<ModelResponse> {
    this.calls.push(req);
    const a = this.answer(req);
    return {
      text: a.text ?? "",
      toolInput: a.toolInput ?? null,
      model: "fake",
      inputTokens: 100,
      outputTokens: 50,
    };
  }
}
