/**
 * Phoenix Bridge Service
 *
 * Manages the lifecycle of Phoenix MCP server connections.
 * Registered via registerService for proper gateway-managed startup/shutdown.
 */

import type { PhoenixMcpClient } from "./phoenix-client.js";

type ServiceContext = {
  config: Record<string, unknown>;
  workspaceDir?: string;
  stateDir: string;
  logger: {
    debug?: (message: string) => void;
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
};

export function createPhoenixService(client: PhoenixMcpClient) {
  return {
    id: "phoenix-bridge",

    async start(ctx: ServiceContext) {
      ctx.logger.info("Starting Phoenix Bridge service...");
      try {
        await client.initialize();
        const status = await client.getSystemStatus();
        const connected = [
          status.memory.connected && "memory",
          status.cluster.connected && "cluster",
          status.agent.connected && "agent",
        ].filter(Boolean);

        ctx.logger.info(`Phoenix Bridge connected: ${connected.join(", ") || "none"}`);
      } catch (err) {
        ctx.logger.warn(`Phoenix Bridge startup failed (will retry on demand): ${err}`);
      }
    },

    async stop(ctx: ServiceContext) {
      ctx.logger.info("Stopping Phoenix Bridge service...");
      await client.close();
    },
  };
}
