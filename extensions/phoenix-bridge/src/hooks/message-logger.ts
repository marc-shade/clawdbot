/**
 * Message Logging Hooks (message_received, message_sent)
 *
 * Records inbound and outbound channel messages to Phoenix enhanced-memory
 * for unified message history across all channels. Fire-and-forget, fail open.
 */

import type { PhoenixMcpClient } from "../phoenix-client.js";

type Logger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type MessageReceivedEvent = {
  from: string;
  content: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
};

type MessageSentEvent = {
  to: string;
  content: string;
  success: boolean;
  error?: string;
};

type MessageContext = {
  channelId: string;
  accountId?: string;
  conversationId?: string;
};

// ---------------------------------------------------------------------------
// message_received — log inbound channel messages
// ---------------------------------------------------------------------------

export function createMessageReceivedHook(client: PhoenixMcpClient, logger: Logger) {
  return async (event: MessageReceivedEvent, ctx: MessageContext): Promise<void> => {
    try {
      const contentPreview = (event.content ?? "").slice(0, 200);

      await client.memoryStore(
        `Message received [${ctx.channelId}] from ${event.from}: ${contentPreview}`,
        {
          entityType: "channel_message_received",
          channelId: ctx.channelId,
          accountId: ctx.accountId,
          conversationId: ctx.conversationId,
          from: event.from,
          contentLength: event.content?.length ?? 0,
          timestamp: event.timestamp ?? Date.now(),
          ...(event.metadata ?? {}),
        },
      );

      logger.debug?.(
        `[message-logger] Recorded inbound message from ${event.from} on ${ctx.channelId}`,
      );
    } catch (err) {
      logger.debug?.(`[message-logger] Failed to record inbound message: ${err}`);
    }
  };
}

// ---------------------------------------------------------------------------
// message_sent — log outbound channel messages
// ---------------------------------------------------------------------------

export function createMessageSentHook(client: PhoenixMcpClient, logger: Logger) {
  return async (event: MessageSentEvent, ctx: MessageContext): Promise<void> => {
    try {
      const contentPreview = (event.content ?? "").slice(0, 200);

      await client.memoryStore(
        `Message sent [${ctx.channelId}] to ${event.to}: ${contentPreview}`,
        {
          entityType: "channel_message_sent",
          channelId: ctx.channelId,
          accountId: ctx.accountId,
          conversationId: ctx.conversationId,
          to: event.to,
          contentLength: event.content?.length ?? 0,
          success: event.success,
          error: event.error,
        },
      );

      logger.debug?.(
        `[message-logger] Recorded outbound message to ${event.to} on ${ctx.channelId} (${event.success ? "ok" : "failed"})`,
      );
    } catch (err) {
      logger.debug?.(`[message-logger] Failed to record outbound message: ${err}`);
    }
  };
}
