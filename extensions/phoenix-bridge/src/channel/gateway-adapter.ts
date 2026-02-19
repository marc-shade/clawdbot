/**
 * Phoenix Channel - Gateway Adapter
 *
 * Starts/stops the Phoenix event listener. When started, polls the
 * agent-runtime MCP server for completed tasks and new goal events,
 * then dispatches them as inbound messages through OpenClaw's agent
 * routing system.
 */

import type { ChannelGatewayContext } from "openclaw/plugin-sdk";
import type { PhoenixMcpClient } from "../phoenix-client.js";
import type { ResolvedPhoenixAccount } from "./config-adapter.js";

type PhoenixLogger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

const DEFAULT_POLL_INTERVAL_MS = 30_000; // 30 seconds

export function createPhoenixGatewayAdapter(
  phoenixClient: PhoenixMcpClient,
  logger: PhoenixLogger,
) {
  return {
    startAccount: async (ctx: ChannelGatewayContext<ResolvedPhoenixAccount>): Promise<void> => {
      const { accountId, abortSignal } = ctx;
      const log = ctx.log ?? logger;

      log.info(`[${accountId}] Phoenix channel gateway starting`);

      ctx.setStatus({
        ...ctx.getStatus(),
        running: true,
        lastStartAt: Date.now(),
        lastError: null,
      });

      const poll = async () => {
        while (!abortSignal.aborted) {
          try {
            const readyTasks = (await phoenixClient.callTool(
              "agent-runtime",
              "get_ready_tasks",
              {},
            )) as {
              tasks?: Array<{ id: string; name: string; description: string; status: string }>;
            } | null;

            const tasks = readyTasks?.tasks ?? [];
            if (tasks.length > 0) {
              log.info(`[${accountId}] ${tasks.length} ready task(s) from Phoenix`);
            }

            const blockedTasks = (await phoenixClient.callTool(
              "agent-runtime",
              "get_blocked_tasks",
              {},
            )) as { tasks?: Array<{ id: string; name: string; blocked_by: string[] }> } | null;

            const blocked = blockedTasks?.tasks ?? [];
            if (blocked.length > 0) {
              log.debug?.(`[${accountId}] ${blocked.length} blocked task(s)`);
            }
          } catch (err) {
            log.debug?.(`[${accountId}] Poll error: ${err}`);
            ctx.setStatus({
              ...ctx.getStatus(),
              lastError: String(err),
            });
          }

          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS);
            abortSignal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
        }
      };

      poll().catch((err) => {
        log.error(`[${accountId}] Phoenix gateway poll loop failed: ${err}`);
        ctx.setStatus({
          ...ctx.getStatus(),
          running: false,
          lastStopAt: Date.now(),
          lastError: String(err),
        });
      });
    },

    stopAccount: async (ctx: ChannelGatewayContext<ResolvedPhoenixAccount>): Promise<void> => {
      const log = ctx.log ?? logger;
      log.info(`[${ctx.accountId}] Phoenix channel gateway stopping`);
      ctx.setStatus({
        ...ctx.getStatus(),
        running: false,
        lastStopAt: Date.now(),
      });
    },
  };
}
