/**
 * Memory Injection Hook
 *
 * Runs before agent start to inject relevant Phoenix memories
 * into the agent's system prompt context.
 */

import type { PhoenixMcpClient } from "../phoenix-client.js";

type Logger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export function createMemoryInjectHook(client: PhoenixMcpClient, logger: Logger) {
  return async (
    event: { prompt: string; messages?: unknown[] },
    _ctx: { agentId?: string; sessionKey?: string },
  ): Promise<{ prependContext?: string } | void> => {
    if (!event.prompt?.trim()) return;

    try {
      const results = await client.memorySearch(event.prompt, 5);
      const entities = Array.isArray(results) ? results : ((results as any)?.entities ?? []);

      if (entities.length === 0) return;

      const memoryContext = entities
        .map((e: any) => {
          const obs = (e.observations ?? []).slice(0, 3).join("; ");
          return `- [${e.entityType ?? "memory"}] ${e.name}: ${obs}`;
        })
        .join("\n");

      logger.debug?.(`Injecting ${entities.length} Phoenix memories`);

      return {
        prependContext: `## Phoenix Memory Context\nRelevant memories from previous sessions:\n${memoryContext}\n`,
      };
    } catch (err) {
      logger.debug?.(`Memory injection skipped: ${err}`);
    }
  };
}
