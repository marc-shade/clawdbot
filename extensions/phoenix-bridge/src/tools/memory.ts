/**
 * Phoenix Memory Tools
 *
 * Exposes Phoenix enhanced-memory-mcp capabilities as OpenClaw tools.
 * Provides 4-tier persistent memory with versioning and RAG.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import type { PhoenixMcpClient } from "../phoenix-client.js";

type ToolContext = {
  agentId?: string;
  sessionKey?: string;
  messageChannel?: string;
};

export function createPhoenixMemoryTools(
  client: PhoenixMcpClient,
  ctx: ToolContext,
  _api: OpenClawPluginApi,
) {
  return [
    {
      name: "phoenix_memory_store",
      label: "Phoenix Memory Store",
      description:
        "Store information in Phoenix persistent memory. Data is stored in a 4-tier memory system with automatic tiering based on access patterns.",
      parameters: Type.Object({
        content: Type.String({
          description: "The content to store in memory",
        }),
        entityType: Type.Optional(
          Type.String({
            description: "Type of entity (e.g., 'learning', 'fact', 'conversation')",
          }),
        ),
        name: Type.Optional(
          Type.String({
            description: "Optional name for the memory entity",
          }),
        ),
        tags: Type.Optional(
          Type.Array(Type.String(), {
            description: "Optional tags for categorization",
          }),
        ),
        scope: Type.Optional(
          Type.String({
            description: "Memory scope: 'personal' (node-specific) or 'shared' (cluster-wide)",
            default: "shared",
          }),
        ),
      }),

      async execute(_id: string, params: Record<string, unknown>) {
        const content = String(params.content ?? "");
        if (!content.trim()) {
          throw new Error("content is required");
        }

        const entityType = String(params.entityType ?? "openclaw_memory");
        const name = String(params.name ?? `openclaw-${Date.now()}`);
        const tags = Array.isArray(params.tags) ? params.tags : [];
        const scope = String(params.scope ?? "shared");

        try {
          const result = await client.callTool("enhanced-memory", "create_entities", {
            entities: [
              {
                name,
                entityType,
                observations: [content],
                metadata: {
                  source: "openclaw",
                  channel: ctx.messageChannel,
                  agentId: ctx.agentId,
                  timestamp: new Date().toISOString(),
                  tags,
                  scope,
                },
              },
            ],
          });

          return {
            content: [
              {
                type: "text" as const,
                text: `Stored in Phoenix memory: ${name}\nType: ${entityType}\nScope: ${scope}`,
              },
            ],
            details: { result, name, entityType, scope },
          };
        } catch (err) {
          throw new Error(`Failed to store in Phoenix memory: ${err}`);
        }
      },
    },

    {
      name: "phoenix_memory_search",
      label: "Phoenix Memory Search",
      description:
        "Search Phoenix persistent memory using semantic similarity. Returns relevant memories based on query meaning.",
      parameters: Type.Object({
        query: Type.String({
          description: "The search query",
        }),
        limit: Type.Optional(
          Type.Number({
            description: "Maximum number of results to return",
            default: 10,
          }),
        ),
        entityType: Type.Optional(
          Type.String({
            description: "Filter by entity type",
          }),
        ),
        scope: Type.Optional(
          Type.String({
            description: "Search scope: 'personal', 'shared', or 'all'",
            default: "all",
          }),
        ),
      }),

      async execute(_id: string, params: Record<string, unknown>) {
        const query = String(params.query ?? "");
        if (!query.trim()) {
          throw new Error("query is required");
        }

        const limit = Number(params.limit ?? 10);
        const entityType = params.entityType ? String(params.entityType) : undefined;
        const scope = String(params.scope ?? "all");

        try {
          const result = await client.callTool("enhanced-memory", "search_nodes", {
            query,
            limit,
            filters: entityType ? { entityType } : undefined,
            scope,
          });

          const entities = Array.isArray(result) ? result : ((result as any)?.entities ?? []);
          const summary =
            entities.length > 0
              ? entities
                  .map(
                    (e: any, i: number) =>
                      `${i + 1}. [${e.entityType}] ${e.name}: ${(e.observations ?? []).slice(0, 100).join(", ")}...`,
                  )
                  .join("\n")
              : "No matching memories found.";

          return {
            content: [
              {
                type: "text" as const,
                text: `Found ${entities.length} memories:\n\n${summary}`,
              },
            ],
            details: { results: entities, query, limit, scope },
          };
        } catch (err) {
          throw new Error(`Failed to search Phoenix memory: ${err}`);
        }
      },
    },

    {
      name: "phoenix_memory_recall",
      label: "Phoenix Memory Recall",
      description:
        "Quick recall from Phoenix memory using NMF (Natural Memory Format) patterns. Optimized for fast retrieval of related information.",
      parameters: Type.Object({
        query: Type.String({
          description: "What to recall",
        }),
        context: Type.Optional(
          Type.String({
            description: "Additional context to improve recall accuracy",
          }),
        ),
      }),

      async execute(_id: string, params: Record<string, unknown>) {
        const query = String(params.query ?? "");
        if (!query.trim()) {
          throw new Error("query is required");
        }

        const context = params.context ? String(params.context) : undefined;

        try {
          const result = await client.callTool("enhanced-memory", "nmf_recall", {
            query,
            context,
          });

          const content = (result as any)?.content ?? String(result);

          return {
            content: [
              {
                type: "text" as const,
                text: content || "No relevant memories found.",
              },
            ],
            details: { result, query, context },
          };
        } catch (err) {
          throw new Error(`Failed to recall from Phoenix memory: ${err}`);
        }
      },
    },
  ];
}
