/**
 * Session Persistence Hooks
 *
 * Persists session outcomes and learnings to Phoenix enhanced-memory
 * on agent_end, session_end, and after_compaction.
 */

import type { PhoenixMcpClient } from "../phoenix-client.js";

type Logger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export function createAgentEndHook(client: PhoenixMcpClient, logger: Logger) {
  return async (
    event: { messages: unknown[]; success: boolean; error?: string; durationMs?: number },
    ctx: { agentId?: string; sessionKey?: string },
  ): Promise<void> => {
    try {
      const messages = event.messages ?? [];
      const lastAssistant = [...messages].reverse().find((m: any) => m.role === "assistant");
      const summary = (lastAssistant as any)?.content?.slice?.(0, 500) ?? "No summary available";

      await client.memoryStore(
        `Session outcome (${event.success ? "success" : "failure"}): ${summary}`,
        {
          entityType: "session_outcome",
          agentId: ctx.agentId,
          sessionKey: ctx.sessionKey,
          durationMs: event.durationMs,
          success: event.success,
          error: event.error,
        },
      );

      logger.debug?.(`Persisted session outcome for ${ctx.sessionKey}`);
    } catch (err) {
      logger.debug?.(`Failed to persist session outcome: ${err}`);
    }
  };
}

export function createSessionEndHook(client: PhoenixMcpClient, logger: Logger) {
  return async (
    event: { sessionId: string; messageCount: number; durationMs?: number },
    ctx: { agentId?: string; sessionId: string },
  ): Promise<void> => {
    try {
      await client.memoryStore(
        `Session ended: ${event.sessionId}, ${event.messageCount} messages, ${event.durationMs ?? 0}ms`,
        {
          entityType: "session_lifecycle",
          agentId: ctx.agentId,
          sessionId: event.sessionId,
          messageCount: event.messageCount,
          durationMs: event.durationMs,
        },
      );

      logger.debug?.(`Persisted session end for ${event.sessionId}`);
    } catch (err) {
      logger.debug?.(`Failed to persist session end: ${err}`);
    }
  };
}

export function createAfterCompactionHook(client: PhoenixMcpClient, logger: Logger) {
  return async (
    event: { messageCount: number; compactedCount: number; sessionFile?: string },
    ctx: { agentId?: string; sessionKey?: string },
  ): Promise<void> => {
    try {
      await client.memoryStore(
        `Session compacted: ${event.compactedCount} messages reduced from ${event.messageCount}`,
        {
          entityType: "compaction_event",
          agentId: ctx.agentId,
          sessionKey: ctx.sessionKey,
          sessionFile: event.sessionFile,
          messageCount: event.messageCount,
          compactedCount: event.compactedCount,
        },
      );

      logger.debug?.(`Persisted compaction event for ${ctx.sessionKey}`);
    } catch (err) {
      logger.debug?.(`Failed to persist compaction event: ${err}`);
    }
  };
}
