/**
 * Telemetry Hooks (llm_input, llm_output, before_compaction)
 *
 * Observability pipeline that records LLM traffic and pre-compaction
 * snapshots to Phoenix enhanced-memory. All hooks are fire-and-forget
 * (return void) and fail open — telemetry should never block operations.
 */

import type { PhoenixMcpClient } from "../phoenix-client.js";

type Logger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

// ---------------------------------------------------------------------------
// Event types (inline to avoid importing from internal SDK paths)
// ---------------------------------------------------------------------------

type LlmInputEvent = {
  runId: string;
  sessionId: string;
  provider: string;
  model: string;
  systemPrompt?: string;
  prompt: string;
  historyMessages: unknown[];
  imagesCount: number;
};

type LlmOutputEvent = {
  runId: string;
  sessionId: string;
  provider: string;
  model: string;
  assistantTexts: string[];
  lastAssistant?: unknown;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
};

type BeforeCompactionEvent = {
  messageCount: number;
  compactingCount?: number;
  tokenCount?: number;
  messages?: unknown[];
  sessionFile?: string;
};

type HookContext = {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
};

// ---------------------------------------------------------------------------
// llm_input hook — record what goes into the model
// ---------------------------------------------------------------------------

export function createLlmInputHook(client: PhoenixMcpClient, logger: Logger) {
  return async (event: LlmInputEvent, _ctx: HookContext): Promise<void> => {
    try {
      const promptPreview = event.prompt.slice(0, 200);
      const historyLen = event.historyMessages?.length ?? 0;

      await client.memoryStore(`LLM input [${event.provider}/${event.model}]: ${promptPreview}`, {
        entityType: "llm_telemetry_input",
        runId: event.runId,
        sessionId: event.sessionId,
        provider: event.provider,
        model: event.model,
        promptLength: event.prompt.length,
        historyMessages: historyLen,
        imagesCount: event.imagesCount,
        hasSystemPrompt: !!event.systemPrompt,
      });

      logger.debug?.(
        `[telemetry] Recorded LLM input: ${event.provider}/${event.model} (${event.prompt.length} chars, ${historyLen} history)`,
      );
    } catch (err) {
      logger.debug?.(`[telemetry] Failed to record LLM input: ${err}`);
    }
  };
}

// ---------------------------------------------------------------------------
// llm_output hook — record what comes out of the model
// ---------------------------------------------------------------------------

export function createLlmOutputHook(client: PhoenixMcpClient, logger: Logger) {
  return async (event: LlmOutputEvent, _ctx: HookContext): Promise<void> => {
    try {
      const outputPreview = (event.assistantTexts ?? []).join(" ").slice(0, 200);
      const usage = event.usage;

      await client.memoryStore(`LLM output [${event.provider}/${event.model}]: ${outputPreview}`, {
        entityType: "llm_telemetry_output",
        runId: event.runId,
        sessionId: event.sessionId,
        provider: event.provider,
        model: event.model,
        outputTexts: event.assistantTexts?.length ?? 0,
        totalOutputChars: (event.assistantTexts ?? []).reduce(
          (sum, t) => sum + (t?.length ?? 0),
          0,
        ),
        inputTokens: usage?.input,
        outputTokens: usage?.output,
        cacheReadTokens: usage?.cacheRead,
        cacheWriteTokens: usage?.cacheWrite,
        totalTokens: usage?.total,
      });

      logger.debug?.(
        `[telemetry] Recorded LLM output: ${event.provider}/${event.model} (${usage?.total ?? "?"} tokens)`,
      );
    } catch (err) {
      logger.debug?.(`[telemetry] Failed to record LLM output: ${err}`);
    }
  };
}

// ---------------------------------------------------------------------------
// before_compaction hook — snapshot session state before compaction
// ---------------------------------------------------------------------------

export function createBeforeCompactionHook(client: PhoenixMcpClient, logger: Logger) {
  return async (event: BeforeCompactionEvent, ctx: HookContext): Promise<void> => {
    try {
      const messageCount = event.messageCount ?? 0;
      const compactingCount = event.compactingCount ?? 0;
      const tokenCount = event.tokenCount ?? 0;

      // Extract key facts from messages before they get compacted away
      let messageSummary = "";
      if (event.messages?.length) {
        const assistantMsgs = (event.messages as Array<{ role?: string; content?: string }>).filter(
          (m) => m.role === "assistant",
        );
        const lastFew = assistantMsgs.slice(-3);
        messageSummary = lastFew.map((m) => (m.content ?? "").slice(0, 150)).join(" | ");
      }

      await client.memoryStore(
        `Pre-compaction snapshot: ${messageCount} messages (compacting ${compactingCount}), ${tokenCount} tokens. Last assistant: ${messageSummary.slice(0, 300)}`,
        {
          entityType: "compaction_snapshot",
          agentId: ctx.agentId,
          sessionKey: ctx.sessionKey,
          sessionFile: event.sessionFile,
          messageCount,
          compactingCount,
          tokenCount,
          assistantSnippets: messageSummary.slice(0, 500),
        },
      );

      logger.debug?.(
        `[telemetry] Pre-compaction snapshot: ${messageCount} msgs, ${compactingCount} compacting, ${tokenCount} tokens`,
      );
    } catch (err) {
      logger.debug?.(`[telemetry] Failed to record pre-compaction snapshot: ${err}`);
    }
  };
}
