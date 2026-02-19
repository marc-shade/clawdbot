import type { ChannelPlugin, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createPhoenixChannelPlugin } from "./src/channel/phoenix-channel.js";
import { createMemoryInjectHook } from "./src/hooks/memory-inject.js";
import {
  createAgentEndHook,
  createSessionEndHook,
  createAfterCompactionHook,
} from "./src/hooks/session-persist.js";
import { createBeforeToolCallHook, createAfterToolCallHook } from "./src/hooks/tool-guard.js";
import { PhoenixMcpClient } from "./src/phoenix-client.js";
import { createOllamaProvider } from "./src/provider/ollama-provider.js";
import { createPhoenixService } from "./src/service.js";
import { createPhoenixAgentTools } from "./src/tools/agent.js";
import { createPhoenixClusterTools } from "./src/tools/cluster.js";
import { createPhoenixMemoryTools } from "./src/tools/memory.js";

const phoenixBridgePlugin = {
  id: "phoenix-bridge",
  name: "Phoenix Bridge",
  description:
    "Bridge to Phoenix AGI system for autonomous task execution, cluster operations, and persistent memory",

  configSchema: {
    jsonSchema: {
      type: "object",
      properties: {
        socketPath: {
          type: "string",
          description: "Path to Phoenix MCP socket (default: stdio)",
        },
        mcpServers: {
          type: "object",
          properties: {
            enhancedMemory: {
              type: "object",
              properties: {
                enabled: { type: "boolean", default: true },
                command: { type: "string" },
                args: { type: "array", items: { type: "string" } },
              },
            },
            clusterExecution: {
              type: "object",
              properties: {
                enabled: { type: "boolean", default: true },
                command: { type: "string" },
                args: { type: "array", items: { type: "string" } },
              },
            },
            agentRuntime: {
              type: "object",
              properties: {
                enabled: { type: "boolean", default: true },
                command: { type: "string" },
                args: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
        prometheusEndpoint: {
          type: "string",
          description: "HTTP endpoint for Prometheus agent loop (optional)",
        },
        clusterNodes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              host: { type: "string" },
              role: {
                type: "string",
                enum: ["orchestrator", "researcher", "developer", "builder"],
              },
            },
          },
        },
        enableMemoryInjection: {
          type: "boolean",
          description: "Auto-inject relevant memories before agent start",
          default: true,
        },
        enableSessionPersist: {
          type: "boolean",
          description: "Auto-persist session outcomes to Phoenix memory",
          default: true,
        },
        enableToolGuard: {
          type: "boolean",
          description: "Enable Ember conscience keeper for tool safety",
          default: true,
        },
      },
    },
    uiHints: {
      socketPath: {
        label: "Phoenix Socket Path",
        help: "Path to Phoenix MCP server socket",
        advanced: true,
      },
      prometheusEndpoint: {
        label: "Prometheus Endpoint",
        help: "HTTP endpoint for autonomous agent execution",
        advanced: true,
      },
      enableMemoryInjection: {
        label: "Memory Injection",
        help: "Auto-inject relevant memories before conversations",
      },
      enableSessionPersist: {
        label: "Session Persistence",
        help: "Auto-store session outcomes to Phoenix memory",
      },
      enableToolGuard: {
        label: "Tool Safety Guard",
        help: "Ember conscience keeper integration for tool gating",
      },
    },
  },

  register(api: OpenClawPluginApi) {
    const logger = api.logger;
    const config = (api.pluginConfig as any) ?? {};

    // Initialize Phoenix MCP client
    const phoenixClient = new PhoenixMcpClient({
      logger,
      getConfig: () => (api.pluginConfig as any) ?? {},
    });

    // =========================================================================
    // 1. Service Lifecycle
    // =========================================================================
    api.registerService(createPhoenixService(phoenixClient));

    // =========================================================================
    // 1b. Channel Registration
    // =========================================================================
    api.registerChannel({
      plugin: createPhoenixChannelPlugin(phoenixClient, logger) as ChannelPlugin,
    });

    // =========================================================================
    // 1c. LLM Provider (Ollama)
    // =========================================================================
    api.registerProvider(createOllamaProvider());

    // =========================================================================
    // 2. Agent Tools (memory, cluster, agent)
    // =========================================================================
    api.registerTool((ctx) => createPhoenixMemoryTools(phoenixClient, ctx, api), {
      names: ["phoenix_memory_store", "phoenix_memory_search", "phoenix_memory_recall"],
    });

    api.registerTool((ctx) => createPhoenixClusterTools(phoenixClient, ctx, api), {
      names: ["phoenix_cluster_execute", "phoenix_cluster_status", "phoenix_offload"],
    });

    api.registerTool((ctx) => createPhoenixAgentTools(phoenixClient, ctx, api), {
      names: ["phoenix_execute_task", "phoenix_create_goal", "phoenix_agent_status"],
    });

    // =========================================================================
    // 3. Lifecycle Hooks
    // =========================================================================

    // Memory injection: inject relevant Phoenix memories before agent starts
    if (config.enableMemoryInjection !== false) {
      api.on("before_agent_start", createMemoryInjectHook(phoenixClient, logger), { priority: 10 });
    }

    // Session persistence: store outcomes to enhanced-memory
    if (config.enableSessionPersist !== false) {
      api.on("agent_end", createAgentEndHook(phoenixClient, logger));
      api.on("session_end", createSessionEndHook(phoenixClient, logger));
      api.on("after_compaction", createAfterCompactionHook(phoenixClient, logger));
    }

    // Tool guard: Ember conscience keeper integration
    if (config.enableToolGuard !== false) {
      api.on("before_tool_call", createBeforeToolCallHook(phoenixClient, logger));
      api.on("after_tool_call", createAfterToolCallHook(phoenixClient, logger));
    }

    // =========================================================================
    // 4. Slash Commands (bypass LLM for quick operations)
    // =========================================================================

    api.registerCommand({
      name: "phoenix",
      description: "Phoenix AGI system status and operations",
      acceptsArgs: true,
      handler: async (ctx) => {
        const args = ctx.args?.trim() ?? "";
        const [subcommand, ...rest] = args.split(/\s+/);

        try {
          switch (subcommand) {
            case "status": {
              const status = await phoenixClient.getSystemStatus();
              const lines = [
                `**Phoenix System Status**`,
                `Memory: ${status.memory.connected ? "connected" : "disconnected"}`,
                `Cluster: ${status.cluster.connected ? "connected" : "disconnected"}`,
                `Agent Runtime: ${status.agent.connected ? "connected" : "disconnected"}`,
              ];
              return { text: lines.join("\n") };
            }

            case "cluster": {
              const clusterStatus = await phoenixClient.getClusterStatus();
              const nodes = Array.isArray(clusterStatus)
                ? clusterStatus
                : ((clusterStatus as any)?.nodes ?? []);
              const lines = nodes.map(
                (n: any) => `- **${n.id}** (${n.role}): ${n.status ?? "unknown"}`,
              );
              return { text: `**Phoenix Cluster**\n${lines.join("\n") || "No nodes found"}` };
            }

            case "memory": {
              const query = rest.join(" ");
              if (!query) return { text: "Usage: /phoenix memory <query>" };
              const results = await phoenixClient.memorySearch(query, 5);
              const entities = Array.isArray(results)
                ? results
                : ((results as any)?.entities ?? []);
              const lines = entities.map(
                (e: any, i: number) =>
                  `${i + 1}. [${e.entityType}] ${e.name}: ${(e.observations ?? []).slice(0, 2).join("; ")}`,
              );
              return {
                text: `**Memory Search** (${entities.length} results)\n${lines.join("\n") || "No results"}`,
              };
            }

            case "goals": {
              const goals = await phoenixClient.callTool("agent-runtime", "list_goals", {});
              const goalList = Array.isArray(goals) ? goals : ((goals as any)?.goals ?? []);
              const lines = goalList.map(
                (g: any) => `- [${g.status}] **${g.name}**: ${(g.description ?? "").slice(0, 60)}`,
              );
              return {
                text: `**Phoenix Goals** (${goalList.length})\n${lines.join("\n") || "No active goals"}`,
              };
            }

            default:
              return {
                text: [
                  "**Phoenix Commands**",
                  "`/phoenix status` - System connection status",
                  "`/phoenix cluster` - Cluster node status",
                  "`/phoenix memory <query>` - Search Phoenix memory",
                  "`/phoenix goals` - List active goals",
                ].join("\n"),
              };
          }
        } catch (err) {
          return { text: `Phoenix error: ${err}` };
        }
      },
    });

    // =========================================================================
    // 5. CLI Commands (terminal)
    // =========================================================================

    api.registerCli(
      ({ program }) => {
        const phoenixCmd = program.command("phoenix").description("Phoenix AGI bridge commands");

        phoenixCmd
          .command("status")
          .description("Check Phoenix system status")
          .action(async () => {
            try {
              const status = await phoenixClient.getSystemStatus();
              console.log(JSON.stringify(status, null, 2));
            } catch (err) {
              console.error("Failed to get Phoenix status:", err);
              process.exit(1);
            }
          });

        phoenixCmd
          .command("execute <task>")
          .description("Execute a task via Prometheus agent loop")
          .option("-m, --max-iterations <n>", "Maximum iterations", "20")
          .option("-p, --parallel", "Enable parallel execution")
          .action(async (task: string, opts: { maxIterations?: string; parallel?: boolean }) => {
            try {
              const result = await phoenixClient.executeTask({
                task,
                maxIterations: parseInt(opts.maxIterations ?? "20", 10),
                parallel: opts.parallel ?? false,
              });
              console.log(JSON.stringify(result, null, 2));
            } catch (err) {
              console.error("Task execution failed:", err);
              process.exit(1);
            }
          });

        phoenixCmd
          .command("cluster")
          .description("Show cluster node status")
          .action(async () => {
            try {
              const nodes = await phoenixClient.getClusterStatus();
              console.log(JSON.stringify(nodes, null, 2));
            } catch (err) {
              console.error("Failed to get cluster status:", err);
              process.exit(1);
            }
          });

        phoenixCmd
          .command("memory <action> <query>")
          .description("Phoenix memory operations (store/search/recall)")
          .action(async (action: string, query: string) => {
            try {
              let result;
              switch (action) {
                case "store":
                  result = await phoenixClient.memoryStore(query);
                  break;
                case "search":
                  result = await phoenixClient.memorySearch(query);
                  break;
                case "recall":
                  result = await phoenixClient.memoryRecall(query);
                  break;
                default:
                  console.error(`Unknown action: ${action}. Use store/search/recall.`);
                  process.exit(1);
              }
              console.log(JSON.stringify(result, null, 2));
            } catch (err) {
              console.error("Memory operation failed:", err);
              process.exit(1);
            }
          });
      },
      { commands: ["phoenix"] },
    );

    // =========================================================================
    // 6. Gateway WebSocket Methods
    // =========================================================================

    // System status
    api.registerGatewayMethod("phoenix.status", async ({ respond }) => {
      try {
        const status = await phoenixClient.getSystemStatus();
        respond(true, status);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    // Task execution
    api.registerGatewayMethod("phoenix.execute", async ({ params, respond }) => {
      try {
        const result = await phoenixClient.executeTask({
          task: String(params.task ?? ""),
          ...(params.options as any),
        });
        respond(true, result as any);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    // Memory operations
    api.registerGatewayMethod("phoenix.memory.search", async ({ params, respond }) => {
      try {
        const result = await phoenixClient.memorySearch(
          String(params.query ?? ""),
          Number(params.limit ?? 10),
        );
        respond(true, result as any);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("phoenix.memory.store", async ({ params, respond }) => {
      try {
        const result = await phoenixClient.memoryStore(
          String(params.content ?? ""),
          params.metadata as any,
        );
        respond(true, result as any);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("phoenix.memory.recall", async ({ params, respond }) => {
      try {
        const result = await phoenixClient.memoryRecall(String(params.query ?? ""));
        respond(true, result as any);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    // Cluster operations
    api.registerGatewayMethod("phoenix.cluster.status", async ({ respond }) => {
      try {
        const result = await phoenixClient.getClusterStatus();
        respond(true, result as any);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("phoenix.cluster.execute", async ({ params, respond }) => {
      try {
        const result = await phoenixClient.clusterExecute(
          String(params.command ?? ""),
          params.nodeId ? String(params.nodeId) : undefined,
        );
        respond(true, result as any);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("phoenix.cluster.offload", async ({ params, respond }) => {
      try {
        const result = await phoenixClient.offloadTask(
          String(params.nodeId ?? ""),
          String(params.command ?? ""),
        );
        respond(true, result as any);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    // Agent operations
    api.registerGatewayMethod("phoenix.agent.goals", async ({ params, respond }) => {
      try {
        const result = await phoenixClient.callTool("agent-runtime", "list_goals", {
          include_completed: params?.includeCompleted ?? false,
        });
        respond(true, result as any);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("phoenix.agent.goal.create", async ({ params, respond }) => {
      try {
        const result = await phoenixClient.createGoal(
          String(params.name ?? ""),
          String(params.description ?? ""),
        );
        respond(true, result as any);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    api.registerGatewayMethod("phoenix.agent.task.next", async ({ params, respond }) => {
      try {
        const result = await phoenixClient.getNextTask(
          params?.goalId ? String(params.goalId) : undefined,
        );
        respond(true, result as any);
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });

    logger.info(
      "Phoenix Bridge v2 registered (provider + channel + hooks + service + commands + gateway)",
    );
  },
};

export default phoenixBridgePlugin;
