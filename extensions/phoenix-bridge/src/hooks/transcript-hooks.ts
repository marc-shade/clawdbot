/**
 * Transcript Hooks (tool_result_persist, before_message_write)
 *
 * Hooks that intercept messages being written to the session transcript.
 *
 * - tool_result_persist: Runs when a tool result is about to be persisted.
 *   Can return a modified message (e.g. to strip large outputs). Currently
 *   logs tool result metadata for analysis. Synchronous (no async).
 *
 * - before_message_write: Runs before any message is written to the session
 *   JSONL file. Can block or modify the message. Currently logs message
 *   metadata for transcript analysis. Synchronous (no async).
 */

import type { PhoenixMcpClient } from "../phoenix-client.js";

type Logger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

// AgentMessage is an internal core type not exported by the plugin SDK.
// Use `any` for the message field to ensure structural compatibility.

type ToolResultPersistEvent = {
  toolName?: string;
  toolCallId?: string;
  message: any;
  isSynthetic?: boolean;
};

type ToolResultPersistContext = {
  agentId?: string;
  sessionKey?: string;
  toolName?: string;
  toolCallId?: string;
};

type ToolResultPersistResult = {
  message?: any;
};

type BeforeMessageWriteEvent = {
  message: any;
  sessionKey?: string;
  agentId?: string;
};

type BeforeMessageWriteResult = {
  block?: boolean;
  message?: any;
};

type MessageWriteContext = {
  agentId?: string;
  sessionKey?: string;
};

// ---------------------------------------------------------------------------
// tool_result_persist — intercept tool results before transcript write
// ---------------------------------------------------------------------------

export function createToolResultPersistHook(client: PhoenixMcpClient, logger: Logger) {
  return (
    event: ToolResultPersistEvent,
    _ctx: ToolResultPersistContext,
  ): ToolResultPersistResult | void => {
    try {
      const toolName = event.toolName ?? "unknown";
      const isSynthetic = event.isSynthetic ?? false;

      // Fire-and-forget: log asynchronously but return synchronously
      client
        .memoryStore(`Tool result persisted: ${toolName} (${isSynthetic ? "synthetic" : "real"})`, {
          entityType: "tool_result_persist",
          toolName,
          toolCallId: event.toolCallId,
          isSynthetic,
          messageRole: event.message?.role,
        })
        .catch((err) => {
          logger.debug?.(`[transcript] Failed to log tool result: ${err}`);
        });

      logger.debug?.(
        `[transcript] Tool result persist: ${toolName}${isSynthetic ? " (synthetic)" : ""}`,
      );

      // Pass through without modification
    } catch (err) {
      logger.debug?.(`[transcript] Error in tool_result_persist hook: ${err}`);
    }
  };
}

// ---------------------------------------------------------------------------
// before_message_write — intercept all messages before transcript write
// ---------------------------------------------------------------------------

export function createBeforeMessageWriteHook(client: PhoenixMcpClient, logger: Logger) {
  return (
    event: BeforeMessageWriteEvent,
    _ctx: MessageWriteContext,
  ): BeforeMessageWriteResult | void => {
    try {
      const role = event.message?.role ?? "unknown";

      // Fire-and-forget: log asynchronously but return synchronously
      client
        .memoryStore(`Message write: ${role} message to transcript`, {
          entityType: "transcript_write",
          role,
          agentId: event.agentId,
          sessionKey: event.sessionKey,
          hasContent: !!event.message?.content,
        })
        .catch((err) => {
          logger.debug?.(`[transcript] Failed to log message write: ${err}`);
        });

      logger.debug?.(`[transcript] Message write: ${role}`);

      // Pass through without blocking or modifying
    } catch (err) {
      logger.debug?.(`[transcript] Error in before_message_write hook: ${err}`);
    }
  };
}
