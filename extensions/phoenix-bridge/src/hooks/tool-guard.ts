/**
 * Tool Guard Hook
 *
 * Integrates with Phoenix Ember conscience keeper to gate
 * dangerous tool calls and log tool usage patterns.
 */

import type { PhoenixMcpClient } from "../phoenix-client.js";

type Logger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

// Tools that should be checked by Ember before execution
const SENSITIVE_TOOLS = new Set([
  "bash",
  "execute_command",
  "write_file",
  "delete_file",
  "send_message",
  "deploy",
]);

export function createBeforeToolCallHook(client: PhoenixMcpClient, logger: Logger) {
  return async (
    event: { toolName: string; params: Record<string, unknown> },
    ctx: { agentId?: string; sessionKey?: string; toolName: string },
  ): Promise<{ block?: boolean; blockReason?: string } | void> => {
    if (!SENSITIVE_TOOLS.has(event.toolName)) return;

    try {
      const result = await client.callTool("agent-runtime", "ember_check_violation", {
        action: event.toolName,
        params: JSON.stringify(event.params).slice(0, 1000),
        context: `agent=${ctx.agentId ?? "unknown"} session=${ctx.sessionKey ?? "unknown"}`,
      });

      const violation = result as any;
      if (violation?.blocked) {
        logger.warn(`Ember blocked tool call: ${event.toolName} - ${violation.reason}`);
        return {
          block: true,
          blockReason: `Phoenix Ember: ${violation.reason ?? "Safety violation detected"}`,
        };
      }
    } catch {
      // Fail open: if Ember is unavailable, allow the tool call
    }
  };
}

export function createAfterToolCallHook(client: PhoenixMcpClient, _logger: Logger) {
  return async (
    event: {
      toolName: string;
      params: Record<string, unknown>;
      error?: string;
      durationMs?: number;
    },
    ctx: { agentId?: string; sessionKey?: string; toolName: string },
  ): Promise<void> => {
    try {
      await client.callTool("agent-runtime", "thunder_record_observation", {
        category: "tool_usage",
        data: {
          tool: event.toolName,
          agentId: ctx.agentId,
          success: !event.error,
          durationMs: event.durationMs,
          timestamp: new Date().toISOString(),
        },
      });
    } catch {
      // Non-critical: tool usage logging is best-effort
    }
  };
}
