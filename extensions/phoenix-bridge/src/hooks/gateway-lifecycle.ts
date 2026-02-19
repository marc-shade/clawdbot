/**
 * Gateway Lifecycle Hooks (gateway_start, gateway_stop)
 *
 * Records WebSocket gateway lifecycle events to Phoenix enhanced-memory.
 * Useful for tracking uptime, restart patterns, and correlating gateway
 * availability with other system events. Fire-and-forget, fail open.
 */

import type { PhoenixMcpClient } from "../phoenix-client.js";

type Logger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type GatewayStartEvent = {
  port: number;
};

type GatewayStopEvent = {
  reason?: string;
};

type GatewayContext = {
  port?: number;
};

// ---------------------------------------------------------------------------
// gateway_start — record WebSocket gateway startup
// ---------------------------------------------------------------------------

export function createGatewayStartHook(client: PhoenixMcpClient, logger: Logger) {
  return async (event: GatewayStartEvent, _ctx: GatewayContext): Promise<void> => {
    try {
      await client.memoryStore(`Gateway started on port ${event.port}`, {
        entityType: "gateway_lifecycle",
        event: "start",
        port: event.port,
      });

      logger.debug?.(`[gateway] Recorded gateway start on port ${event.port}`);
    } catch (err) {
      logger.debug?.(`[gateway] Failed to record gateway start: ${err}`);
    }
  };
}

// ---------------------------------------------------------------------------
// gateway_stop — record WebSocket gateway shutdown
// ---------------------------------------------------------------------------

export function createGatewayStopHook(client: PhoenixMcpClient, logger: Logger) {
  return async (event: GatewayStopEvent, _ctx: GatewayContext): Promise<void> => {
    try {
      const reason = event.reason ?? "normal shutdown";

      await client.memoryStore(`Gateway stopped: ${reason}`, {
        entityType: "gateway_lifecycle",
        event: "stop",
        reason,
      });

      logger.debug?.(`[gateway] Recorded gateway stop: ${reason}`);
    } catch (err) {
      logger.debug?.(`[gateway] Failed to record gateway stop: ${err}`);
    }
  };
}
