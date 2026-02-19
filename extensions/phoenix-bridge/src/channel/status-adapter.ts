/**
 * Phoenix Channel - Status Adapter
 *
 * Probes Phoenix MCP server connectivity and builds account snapshots
 * for the OpenClaw status dashboard.
 */

import type { PhoenixMcpClient } from "../phoenix-client.js";
import type { ResolvedPhoenixAccount } from "./config-adapter.js";

export type PhoenixProbe = {
  ok: boolean;
  memory: boolean;
  cluster: boolean;
  agent: boolean;
  latencyMs: number;
};

export function createPhoenixStatusAdapter(phoenixClient: PhoenixMcpClient) {
  return {
    defaultRuntime: {
      accountId: "default",
      running: false,
      lastStartAt: null as number | null,
      lastStopAt: null as number | null,
      lastError: null as string | null,
    },

    probeAccount: async ({
      timeoutMs,
    }: {
      account: ResolvedPhoenixAccount;
      timeoutMs: number;
      cfg: unknown;
    }): Promise<PhoenixProbe> => {
      const start = Date.now();
      try {
        const status = await Promise.race([
          phoenixClient.getSystemStatus(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("probe timeout")), timeoutMs),
          ),
        ]);
        return {
          ok: status.memory.connected || status.cluster.connected || status.agent.connected,
          memory: status.memory.connected,
          cluster: status.cluster.connected,
          agent: status.agent.connected,
          latencyMs: Date.now() - start,
        };
      } catch {
        return {
          ok: false,
          memory: false,
          cluster: false,
          agent: false,
          latencyMs: Date.now() - start,
        };
      }
    },

    buildAccountSnapshot: ({
      account,
      runtime,
      probe,
    }: {
      account: ResolvedPhoenixAccount;
      cfg: unknown;
      runtime?: {
        accountId: string;
        running?: boolean;
        lastStartAt?: number | null;
        lastStopAt?: number | null;
        lastError?: string | null;
      };
      probe?: PhoenixProbe;
    }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      probe,
    }),
  };
}
