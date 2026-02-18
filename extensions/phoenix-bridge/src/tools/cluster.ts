/**
 * Phoenix Cluster Tools
 *
 * Exposes Phoenix cluster-execution-mcp capabilities as OpenClaw tools.
 * Enables distributed task execution across the 4-node cluster.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import type { PhoenixMcpClient } from "../phoenix-client.js";

type ToolContext = {
  agentId?: string;
  sessionKey?: string;
  messageChannel?: string;
};

export function createPhoenixClusterTools(
  client: PhoenixMcpClient,
  _ctx: ToolContext,
  _api: OpenClawPluginApi,
) {
  return [
    {
      name: "phoenix_cluster_execute",
      label: "Phoenix Cluster Execute",
      description:
        "Execute a bash command on the Phoenix cluster. The command will be routed to the most appropriate node based on workload and capabilities.",
      parameters: Type.Object({
        command: Type.String({
          description: "The bash command to execute",
        }),
        requiresDocker: Type.Optional(
          Type.Boolean({
            description: "If true, routes to a node with Docker/container support",
          }),
        ),
        requiresGpu: Type.Optional(
          Type.Boolean({
            description: "If true, routes to a node with GPU capabilities",
          }),
        ),
        timeoutMs: Type.Optional(
          Type.Number({
            description: "Command timeout in milliseconds",
            default: 60000,
          }),
        ),
      }),

      async execute(_id: string, params: Record<string, unknown>) {
        const command = String(params.command ?? "");
        if (!command.trim()) {
          throw new Error("command is required");
        }

        const requiresDocker = Boolean(params.requiresDocker);
        const requiresGpu = Boolean(params.requiresGpu);
        const timeoutMs = Number(params.timeoutMs ?? 60000);

        try {
          const result = await client.callTool("cluster-execution", "cluster_bash", {
            command,
            requires_docker: requiresDocker,
            requires_gpu: requiresGpu,
            timeout_ms: timeoutMs,
          });

          const output = (result as any)?.output ?? (result as any)?.stdout ?? String(result);
          const exitCode = (result as any)?.exit_code ?? (result as any)?.returncode ?? 0;
          const node = (result as any)?.node ?? "unknown";

          return {
            content: [
              {
                type: "text" as const,
                text: `Executed on ${node} (exit ${exitCode}):\n${output}`,
              },
            ],
            details: { result, command, node, exitCode },
          };
        } catch (err) {
          throw new Error(`Cluster execution failed: ${err}`);
        }
      },
    },

    {
      name: "phoenix_cluster_status",
      label: "Phoenix Cluster Status",
      description:
        "Get the status of all nodes in the Phoenix cluster, including health, load, and capabilities.",
      parameters: Type.Object({}),

      async execute(_id: string, _params: Record<string, unknown>) {
        try {
          const result = await client.getClusterStatus();

          const nodes = Array.isArray(result) ? result : ((result as any)?.nodes ?? []);
          const summary = nodes
            .map(
              (n: any) =>
                `• ${n.id} (${n.role}): ${n.status ?? "unknown"} - Load: ${n.load ?? "N/A"}`,
            )
            .join("\n");

          return {
            content: [
              {
                type: "text" as const,
                text: `Phoenix Cluster Status:\n\n${summary || "No nodes found"}`,
              },
            ],
            details: { nodes },
          };
        } catch (err) {
          throw new Error(`Failed to get cluster status: ${err}`);
        }
      },
    },

    {
      name: "phoenix_offload",
      label: "Phoenix Offload Task",
      description:
        "Offload a task to a specific node in the Phoenix cluster. Use this when you need specific node capabilities.",
      parameters: Type.Object({
        nodeId: Type.String({
          description:
            "Target node ID: 'mac-studio' (orchestrator), 'macbook-air' (researcher), 'macmini' (developer), 'macpro51' (builder/Linux)",
        }),
        command: Type.String({
          description: "The command to execute on the target node",
        }),
        waitForResult: Type.Optional(
          Type.Boolean({
            description: "If true, wait for command completion",
            default: true,
          }),
        ),
      }),

      async execute(_id: string, params: Record<string, unknown>) {
        const nodeId = String(params.nodeId ?? "");
        const command = String(params.command ?? "");

        if (!nodeId.trim()) {
          throw new Error("nodeId is required");
        }
        if (!command.trim()) {
          throw new Error("command is required");
        }

        const waitForResult = params.waitForResult !== false;

        try {
          const result = await client.callTool("cluster-execution", "offload_to", {
            node_id: nodeId,
            command,
            wait: waitForResult,
          });

          const output = (result as any)?.output ?? (result as any)?.stdout ?? String(result);
          const exitCode = (result as any)?.exit_code ?? (result as any)?.returncode ?? 0;

          return {
            content: [
              {
                type: "text" as const,
                text: waitForResult
                  ? `Offloaded to ${nodeId} (exit ${exitCode}):\n${output}`
                  : `Task offloaded to ${nodeId}. Task ID: ${(result as any)?.task_id ?? "pending"}`,
              },
            ],
            details: { result, nodeId, command, exitCode },
          };
        } catch (err) {
          throw new Error(`Failed to offload to ${nodeId}: ${err}`);
        }
      },
    },
  ];
}
