/**
 * Message Sending Filter Hook (message_sending)
 *
 * Inspects outbound channel messages before they are sent. Can modify
 * message content or cancel delivery. Currently used for:
 * - Logging outbound message attempts to enhanced-memory
 * - Future: content policy enforcement, PII redaction
 *
 * Unlike message_sent (fire-and-forget after delivery), this hook runs
 * BEFORE send and can return { content, cancel } to alter behavior.
 */

import type { PhoenixMcpClient } from "../phoenix-client.js";

type Logger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type MessageSendingEvent = {
  to: string;
  content: string;
  metadata?: Record<string, unknown>;
};

type MessageSendingResult = {
  content?: string;
  cancel?: boolean;
};

type MessageContext = {
  channelId: string;
  accountId?: string;
  conversationId?: string;
};

export function createMessageSendingHook(client: PhoenixMcpClient, logger: Logger) {
  return async (
    event: MessageSendingEvent,
    ctx: MessageContext,
  ): Promise<MessageSendingResult | void> => {
    try {
      const contentPreview = (event.content ?? "").slice(0, 200);

      // Log the outbound attempt (before delivery confirmation)
      await client.memoryStore(
        `Message sending [${ctx.channelId}] to ${event.to}: ${contentPreview}`,
        {
          entityType: "channel_message_sending",
          channelId: ctx.channelId,
          accountId: ctx.accountId,
          conversationId: ctx.conversationId,
          to: event.to,
          contentLength: event.content?.length ?? 0,
          ...(event.metadata ?? {}),
        },
      );

      logger.debug?.(
        `[message-filter] Recorded outbound attempt to ${event.to} on ${ctx.channelId}`,
      );

      // Pass through without modification — future: add content policy checks here
    } catch (err) {
      // Fail open: never block message delivery due to logging errors
      logger.debug?.(`[message-filter] Failed to record outbound attempt: ${err}`);
    }
  };
}
