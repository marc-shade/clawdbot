/**
 * Session Lifecycle Hooks (session_start, before_reset)
 *
 * Records session start events and pre-reset snapshots to Phoenix
 * enhanced-memory. Complements session-persist.ts which handles
 * session_end and agent_end.
 *
 * - session_start: logs session creation (including resumed sessions)
 * - before_reset: snapshots session state before /new or /reset clears it
 */

import type { PhoenixMcpClient } from "../phoenix-client.js";

type Logger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type SessionStartEvent = {
  sessionId: string;
  resumedFrom?: string;
};

type SessionContext = {
  agentId?: string;
  sessionId: string;
};

type BeforeResetEvent = {
  sessionFile?: string;
  messages?: unknown[];
  reason?: string;
};

type AgentContext = {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  messageProvider?: string;
};

// ---------------------------------------------------------------------------
// session_start — record new session creation
// ---------------------------------------------------------------------------

export function createSessionStartHook(client: PhoenixMcpClient, logger: Logger) {
  return async (event: SessionStartEvent, ctx: SessionContext): Promise<void> => {
    try {
      const resumed = event.resumedFrom ? ` (resumed from ${event.resumedFrom})` : "";

      await client.memoryStore(`Session started: ${event.sessionId}${resumed}`, {
        entityType: "session_lifecycle",
        event: "start",
        sessionId: event.sessionId,
        agentId: ctx.agentId,
        resumedFrom: event.resumedFrom,
      });

      logger.debug?.(`[session] Recorded session start: ${event.sessionId}${resumed}`);
    } catch (err) {
      logger.debug?.(`[session] Failed to record session start: ${err}`);
    }
  };
}

// ---------------------------------------------------------------------------
// before_reset — snapshot session before /new or /reset clears it
// ---------------------------------------------------------------------------

export function createBeforeResetHook(client: PhoenixMcpClient, logger: Logger) {
  return async (event: BeforeResetEvent, ctx: AgentContext): Promise<void> => {
    try {
      const messageCount = event.messages?.length ?? 0;
      const reason = event.reason ?? "user reset";

      // Capture a summary of the session being cleared
      let lastAssistantSnippet = "";
      if (event.messages?.length) {
        const assistantMsgs = (event.messages as Array<{ role?: string; content?: string }>)
          .filter((m) => m.role === "assistant")
          .slice(-1);
        lastAssistantSnippet = (assistantMsgs[0]?.content ?? "").slice(0, 300);
      }

      await client.memoryStore(
        `Session reset (${reason}): ${messageCount} messages cleared. Last assistant: ${lastAssistantSnippet.slice(0, 200)}`,
        {
          entityType: "session_reset",
          agentId: ctx.agentId,
          sessionKey: ctx.sessionKey,
          sessionFile: event.sessionFile,
          messageCount,
          reason,
        },
      );

      logger.debug?.(
        `[session] Recorded pre-reset snapshot: ${messageCount} messages, reason: ${reason}`,
      );
    } catch (err) {
      logger.debug?.(`[session] Failed to record pre-reset snapshot: ${err}`);
    }
  };
}
