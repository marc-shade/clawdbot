/**
 * Model Router Hook (before_model_resolve)
 *
 * Analyzes the user prompt and routes simple/cheap tasks to a local
 * Ollama model, keeping expensive Claude API calls for complex work.
 *
 * Only activates when the Ollama provider is configured (via /login ollama).
 * Fails open — any error returns void (uses default model).
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";

type Logger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type ModelRouterConfig = {
  ollamaModel?: string;
  maxPromptLength?: number;
};

type ModelResolveEvent = {
  prompt: string;
};

type ModelResolveContext = {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  messageProvider?: string;
};

type ModelResolveResult = {
  modelOverride?: string;
  providerOverride?: string;
};

// ---------------------------------------------------------------------------
// Prompt complexity analysis
// ---------------------------------------------------------------------------

/** Keywords that signal complex work requiring a capable model */
const COMPLEX_PATTERNS = [
  /\bimplement\b/i,
  /\brefactor\b/i,
  /\barchitect\b/i,
  /\bdesign\b/i,
  /\bdebug\b/i,
  /\bfix\s+(the|this|a)\b/i,
  /\bbuild\b/i,
  /\bdeploy\b/i,
  /\bmigrat/i,
  /\bsecurity\b/i,
  /\bvulnerabilit/i,
  /\breview\s+(this|the|my)\s+(code|pr|pull)/i,
  /\boptimiz/i,
  /\bperformance\b/i,
  /\btest(s|ing)?\s+(for|the|this|my)/i,
  /\bwrite\s+(a|the|this)\s+(function|class|module|component|service)/i,
  /\bcreate\s+(a|the|this)\s+(file|api|endpoint|database|schema)/i,
  /\banalyze\s+(this|the|my)\s+(code|codebase|repo)/i,
  /\bmulti[- ]step/i,
  /\bcomplex\b/i,
];

/** Keywords that signal simple work suitable for a local model */
const SIMPLE_PATTERNS = [
  /\bexplain\b/i,
  /\bsummariz/i,
  /\btranslat/i,
  /\bformat\b/i,
  /\blist\s+(the|all|my)/i,
  /\bwhat\s+(is|are|does|do)\b/i,
  /\bhow\s+(do|does|to|can)\b/i,
  /\bwhy\s+(is|are|does|do|did)\b/i,
  /\bdefine\b/i,
  /\bdescribe\b/i,
  /\bcompare\b/i,
  /\bconvert\b/i,
  /\brename\b/i,
  /\bcount\b/i,
  /\bshow\s+(me|the)\b/i,
];

/** Patterns indicating the prompt references specific code/files (keep on Claude) */
const CODE_REFERENCE_PATTERNS = [
  /\.(ts|js|py|rs|go|java|rb|tsx|jsx|css|html|json|yaml|yml|toml|sql)\b/,
  /\bsrc\//,
  /\bextensions\//,
  /\bpackages?\//,
  /```[\s\S]+```/,
  /\bfunction\s+\w+/,
  /\bclass\s+\w+/,
  /\bimport\s+/,
];

function scorePromptComplexity(prompt: string): number {
  let score = 0;

  // Length factor: longer prompts tend to be more complex
  if (prompt.length > 500) score += 3;
  else if (prompt.length > 200) score += 1;

  // Newlines suggest multi-part requests
  const lineCount = prompt.split("\n").filter((l) => l.trim()).length;
  if (lineCount > 5) score += 2;

  // Complex keyword matches
  for (const pattern of COMPLEX_PATTERNS) {
    if (pattern.test(prompt)) {
      score += 2;
    }
  }

  // Simple keyword matches (reduce score)
  for (const pattern of SIMPLE_PATTERNS) {
    if (pattern.test(prompt)) {
      score -= 2;
    }
  }

  // Code references strongly suggest keeping on Claude
  for (const pattern of CODE_REFERENCE_PATTERNS) {
    if (pattern.test(prompt)) {
      score += 3;
      break; // One match is enough
    }
  }

  return score;
}

// ---------------------------------------------------------------------------
// Ollama availability check
// ---------------------------------------------------------------------------

function getOllamaModelFromConfig(
  openClawConfig: OpenClawConfig,
  preferredModel?: string,
): string | null {
  const providers = (openClawConfig as any).models?.providers;
  if (!providers?.ollama?.models?.length) return null;

  const models = providers.ollama.models as Array<{ id: string; name: string }>;

  // Use preferred model if specified and available
  if (preferredModel) {
    const match = models.find((m) => m.id === preferredModel || m.id.startsWith(preferredModel));
    if (match) return match.id;
  }

  // Return first available model
  return models[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Hook factory
// ---------------------------------------------------------------------------

/** Complexity score threshold: prompts scoring below this route to Ollama */
const DEFAULT_THRESHOLD = 0;
const DEFAULT_MAX_PROMPT_LENGTH = 300;

export function createModelRouterHook(
  getConfig: () => OpenClawConfig,
  routerConfig: ModelRouterConfig,
  logger: Logger,
) {
  return (event: ModelResolveEvent, _ctx: ModelResolveContext): ModelResolveResult | void => {
    const prompt = event.prompt?.trim();
    if (!prompt) return;

    try {
      const config = getConfig();
      const ollamaModel = getOllamaModelFromConfig(config, routerConfig.ollamaModel);

      // No Ollama configured — nothing to route to
      if (!ollamaModel) return;

      const maxLength = routerConfig.maxPromptLength ?? DEFAULT_MAX_PROMPT_LENGTH;

      // Quick length gate: very long prompts skip scoring
      if (prompt.length > maxLength * 3) {
        logger.debug?.(`[model-router] Long prompt (${prompt.length} chars) → default`);
        return;
      }

      const score = scorePromptComplexity(prompt);

      if (score < DEFAULT_THRESHOLD) {
        logger.info(`[model-router] Simple prompt (score=${score}) → ollama/${ollamaModel}`);
        return {
          modelOverride: ollamaModel,
          providerOverride: "ollama",
        };
      }

      logger.debug?.(`[model-router] Complex prompt (score=${score}) → default`);
    } catch (err) {
      logger.debug?.(`[model-router] Error: ${err}`);
    }
  };
}
