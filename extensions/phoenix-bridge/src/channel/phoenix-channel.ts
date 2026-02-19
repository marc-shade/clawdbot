/**
 * Phoenix Channel Plugin
 *
 * Registers Phoenix AGI as a channel in OpenClaw, making it accessible
 * through the same channel management CLI and routing system used by
 * Telegram, Slack, Discord, etc.
 */

import type { ChannelPlugin } from "openclaw/plugin-sdk";
import type { PhoenixMcpClient } from "../phoenix-client.js";
import { createPhoenixConfigAdapter, type ResolvedPhoenixAccount } from "./config-adapter.js";
import { createPhoenixGatewayAdapter } from "./gateway-adapter.js";
import { createPhoenixOutboundAdapter } from "./outbound-adapter.js";
import { createPhoenixStatusAdapter, type PhoenixProbe } from "./status-adapter.js";

type PhoenixLogger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export function createPhoenixChannelPlugin(
  phoenixClient: PhoenixMcpClient,
  logger: PhoenixLogger,
): ChannelPlugin<ResolvedPhoenixAccount, PhoenixProbe> {
  const configAdapter = createPhoenixConfigAdapter();
  const gatewayAdapter = createPhoenixGatewayAdapter(phoenixClient, logger);
  const outboundAdapter = createPhoenixOutboundAdapter(phoenixClient);
  const statusAdapter = createPhoenixStatusAdapter(phoenixClient);

  return {
    id: "phoenix",

    meta: {
      id: "phoenix",
      label: "Phoenix",
      selectionLabel: "Phoenix AGI",
      docsPath: "phoenix",
      blurb:
        "Phoenix AGI system channel for autonomous task execution, cluster operations, and persistent memory",
      order: 100,
    },

    capabilities: {
      chatTypes: ["direct"],
      reactions: false,
      threads: false,
      media: false,
      polls: false,
      nativeCommands: false,
      blockStreaming: true,
    },

    reload: { configPrefixes: ["channels.phoenix"] },

    config: configAdapter,

    security: {
      resolveDmPolicy: () => ({
        policy: "open",
        allowFrom: [],
        policyPath: "channels.phoenix.dmPolicy",
        allowFromPath: "channels.phoenix.",
        approveHint: "Phoenix is a trusted local system channel",
      }),
    },

    outbound: outboundAdapter,
    status: statusAdapter,
    gateway: gatewayAdapter,
  };
}
