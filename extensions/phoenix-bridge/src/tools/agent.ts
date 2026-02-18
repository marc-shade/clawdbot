/**
 * Phoenix Agent Tools
 *
 * Exposes Phoenix agent-runtime-mcp and Prometheus capabilities as OpenClaw tools.
 * Enables autonomous task execution with planning, execution, and verification.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import type { PhoenixMcpClient } from "../phoenix-client.js";

type ToolContext = {
  agentId?: string;
  sessionKey?: string;
  messageChannel?: string;
};

export function createPhoenixAgentTools(
  client: PhoenixMcpClient,
  ctx: ToolContext,
  _api: OpenClawPluginApi,
) {
  return [
    {
      name: "phoenix_execute_task",
      label: "Phoenix Execute Task",
      description:
        "Execute a complex task using the Phoenix Prometheus agent loop. The task will be automatically decomposed, planned, executed, and verified.",
      parameters: Type.Object({
        task: Type.String({
          description: "Description of the task to execute",
        }),
        maxIterations: Type.Optional(
          Type.Number({
            description: "Maximum iterations for the agent loop",
            default: 20,
          }),
        ),
        executionMode: Type.Optional(
          Type.String({
            description: "Execution mode: 'sequential' (safe), 'parallel' (fast), or 'auto'",
            default: "auto",
          }),
        ),
        context: Type.Optional(
          Type.String({
            description: "Additional context for the task",
          }),
        ),
      }),

      async execute(_id: string, params: Record<string, unknown>) {
        const task = String(params.task ?? "");
        if (!task.trim()) {
          throw new Error("task is required");
        }

        const maxIterations = Number(params.maxIterations ?? 20);
        const executionMode = String(params.executionMode ?? "auto");
        const context = params.context ? String(params.context) : undefined;

        try {
          const result = await client.executeTask({
            task: context ? `${task}\n\nContext: ${context}` : task,
            maxIterations,
            parallel: executionMode === "parallel",
          });

          const taskResult = result as any;
          const status = taskResult?.status ?? "unknown";
          const summary = taskResult?.summary ?? "Task submitted";
          const stepsCompleted = taskResult?.steps_completed ?? 0;

          return {
            content: [
              {
                type: "text" as const,
                text: `Task ${status}:\n${summary}\n\nSteps completed: ${stepsCompleted}`,
              },
            ],
            details: { result, task, maxIterations, executionMode },
          };
        } catch (err) {
          throw new Error(`Task execution failed: ${err}`);
        }
      },
    },

    {
      name: "phoenix_create_goal",
      label: "Phoenix Create Goal",
      description:
        "Create a persistent goal in Phoenix agent-runtime. Goals persist across sessions and can be decomposed into tasks.",
      parameters: Type.Object({
        name: Type.String({
          description: "Short name for the goal",
        }),
        description: Type.String({
          description: "Detailed description of what needs to be achieved",
        }),
        priority: Type.Optional(
          Type.Number({
            description: "Priority level (1-10, higher = more important)",
            default: 5,
          }),
        ),
        deadline: Type.Optional(
          Type.String({
            description: "Optional deadline in ISO format",
          }),
        ),
      }),

      async execute(_id: string, params: Record<string, unknown>) {
        const name = String(params.name ?? "");
        const description = String(params.description ?? "");

        if (!name.trim()) {
          throw new Error("name is required");
        }
        if (!description.trim()) {
          throw new Error("description is required");
        }

        const priority = Number(params.priority ?? 5);
        const deadline = params.deadline ? String(params.deadline) : undefined;

        try {
          const result = await client.callTool("agent-runtime", "create_goal", {
            name,
            description,
            priority,
            deadline,
            metadata: {
              source: "openclaw",
              channel: ctx.messageChannel,
              agentId: ctx.agentId,
              createdAt: new Date().toISOString(),
            },
          });

          const goalId = (result as any)?.goal_id ?? (result as any)?.id ?? "unknown";

          return {
            content: [
              {
                type: "text" as const,
                text: `Goal created: ${name}\nID: ${goalId}\nPriority: ${priority}${deadline ? `\nDeadline: ${deadline}` : ""}`,
              },
            ],
            details: { result, goalId, name, description, priority },
          };
        } catch (err) {
          throw new Error(`Failed to create goal: ${err}`);
        }
      },
    },

    {
      name: "phoenix_agent_status",
      label: "Phoenix Agent Status",
      description:
        "Get the status of Phoenix agent-runtime, including active goals, pending tasks, and execution metrics.",
      parameters: Type.Object({
        goalId: Type.Optional(
          Type.String({
            description: "Optional goal ID to get specific goal status",
          }),
        ),
        includeCompleted: Type.Optional(
          Type.Boolean({
            description: "Include completed goals/tasks in the response",
            default: false,
          }),
        ),
      }),

      async execute(_id: string, params: Record<string, unknown>) {
        const goalId = params.goalId ? String(params.goalId) : undefined;
        const includeCompleted = Boolean(params.includeCompleted);

        try {
          let result;

          if (goalId) {
            result = await client.callTool("agent-runtime", "get_goal", {
              goal_id: goalId,
            });
          } else {
            result = await client.callTool("agent-runtime", "list_goals", {
              include_completed: includeCompleted,
            });
          }

          const goals = Array.isArray(result) ? result : ((result as any)?.goals ?? [result]);
          const summary = goals
            .map(
              (g: any) =>
                `• [${g.status ?? "active"}] ${g.name}: ${g.description?.slice(0, 60) ?? "No description"}...`,
            )
            .join("\n");

          return {
            content: [
              {
                type: "text" as const,
                text: goalId
                  ? `Goal Status:\n${summary}`
                  : `Phoenix Agent Status:\n\nGoals (${goals.length}):\n${summary || "No active goals"}`,
              },
            ],
            details: { goals, goalId, includeCompleted },
          };
        } catch (err) {
          throw new Error(`Failed to get agent status: ${err}`);
        }
      },
    },
  ];
}
