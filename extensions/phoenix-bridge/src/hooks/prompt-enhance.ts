/**
 * Prompt Enhancement Hook (before_prompt_build)
 *
 * Runs after before_agent_start but with access to session messages.
 * Searches enhanced-memory for context relevant to both the prompt
 * and recent conversation, then injects it via prependContext.
 *
 * Differs from memory-inject (before_agent_start) in that it has
 * access to session history, enabling conversation-aware retrieval.
 */

import type { PhoenixMcpClient } from "../phoenix-client.js";

type Logger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type BeforePromptBuildEvent = {
  prompt: string;
  messages: unknown[];
};

type BeforePromptBuildResult = {
  systemPrompt?: string;
  prependContext?: string;
};

type AgentContext = {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  messageProvider?: string;
};

/**
 * Extract key topics from recent messages for context-aware memory search.
 * Pulls the last few user messages and builds a search query from them.
 */
function extractConversationTopics(messages: unknown[], maxMessages = 3): string {
  const userMsgs = (messages as Array<{ role?: string; content?: string }>)
    .filter((m) => m.role === "user" && m.content)
    .slice(-maxMessages);

  if (!userMsgs.length) return "";

  return userMsgs.map((m) => (m.content ?? "").slice(0, 100)).join(" ");
}

export function createPromptEnhanceHook(client: PhoenixMcpClient, logger: Logger) {
  return async (
    event: BeforePromptBuildEvent,
    _ctx: AgentContext,
  ): Promise<BeforePromptBuildResult | void> => {
    try {
      const prompt = event.prompt?.trim();
      if (!prompt) return;

      // Build a search query from both the current prompt and recent conversation
      const conversationContext = extractConversationTopics(event.messages ?? []);
      const searchQuery = conversationContext
        ? `${prompt.slice(0, 150)} ${conversationContext.slice(0, 150)}`
        : prompt.slice(0, 300);

      const results = await client.memorySearch(searchQuery, 3);
      const entities = Array.isArray(results) ? results : ((results as any)?.entities ?? []);

      if (!entities.length) return;

      const contextLines = entities.map((e: any) => {
        const obs = (e.observations ?? []).slice(0, 2).join("; ");
        return `- [${e.entityType}] ${e.name}: ${obs}`;
      });

      const prependContext = ["## Relevant Phoenix Memories", ...contextLines, ""].join("\n");

      logger.debug?.(
        `[prompt-enhance] Injecting ${entities.length} memory entities into prompt context`,
      );

      return { prependContext };
    } catch (err) {
      logger.debug?.(`[prompt-enhance] Failed to enhance prompt: ${err}`);
    }
  };
}
