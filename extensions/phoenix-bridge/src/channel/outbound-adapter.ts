/**
 * Phoenix Channel - Outbound Adapter
 *
 * Delivers agent responses back to Phoenix. Text responses are stored
 * in enhanced-memory as channel response entities.
 */

import type { PhoenixMcpClient } from "../phoenix-client.js";

export function createPhoenixOutboundAdapter(phoenixClient: PhoenixMcpClient) {
  return {
    deliveryMode: "direct" as const,
    textChunkLimit: 32000,

    sendText: async (ctx: { to: string; text: string; accountId?: string | null }) => {
      const entityId = `phoenix-response-${Date.now()}`;
      try {
        await phoenixClient.memoryStore(ctx.text, {
          source: "openclaw_channel",
          type: "agent_response",
          target: ctx.to,
          entityId,
        });
      } catch {
        // Fail open — don't block the agent response pipeline
      }
      return { channel: "phoenix" as const, messageId: entityId };
    },
  };
}
