/**
 * Ollama LLM Provider
 *
 * Registers local Ollama instances as an LLM provider in OpenClaw, making
 * all locally-running models available through the unified model selector.
 *
 * Auth flow discovers models dynamically via Ollama's /api/tags endpoint
 * and builds the provider config with correct context windows and capabilities.
 */

import type { ProviderAuthContext, ProviderAuthResult } from "openclaw/plugin-sdk";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_CONTEXT_WINDOW = 131_072; // 128K — most modern models
const DEFAULT_MAX_TOKENS = 8192;

type OllamaModel = {
  name: string;
  model: string;
  size: number;
  details?: {
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
};

type OllamaTagsResponse = {
  models?: OllamaModel[];
};

type OllamaShowResponse = {
  model_info?: Record<string, unknown>;
  parameters?: string;
};

// ---------------------------------------------------------------------------
// Model capability inference from name/family
// ---------------------------------------------------------------------------

const VISION_PATTERNS = [/llava/i, /vision/i, /bakllava/i, /minicpm.*v/i, /moondream/i, /cogvlm/i];

const REASONING_PATTERNS = [/deepseek-r1/i, /qwq/i, /marco-o1/i, /\bsky-t1\b/i];

const CONTEXT_OVERRIDES: Record<string, number> = {
  gemma2: 8192,
  gemma: 8192,
  phi: 4096,
  tinyllama: 2048,
  "all-minilm": 512,
};

function inferCapabilities(model: OllamaModel): {
  reasoning: boolean;
  input: Array<"text" | "image">;
  contextWindow: number;
} {
  const name = model.name.toLowerCase();
  const family = model.details?.family?.toLowerCase() ?? "";

  const isVision = VISION_PATTERNS.some((p) => p.test(name));
  const isReasoning = REASONING_PATTERNS.some((p) => p.test(name));

  let contextWindow = DEFAULT_CONTEXT_WINDOW;
  for (const [prefix, size] of Object.entries(CONTEXT_OVERRIDES)) {
    if (family.startsWith(prefix) || name.startsWith(prefix)) {
      contextWindow = size;
      break;
    }
  }

  return {
    reasoning: isReasoning,
    input: isVision ? ["text", "image"] : ["text"],
    contextWindow,
  };
}

function humanName(model: OllamaModel): string {
  const name = model.name.replace(/:latest$/, "");
  const size = model.details?.parameter_size;
  const quant = model.details?.quantization_level;
  const parts = [name];
  if (size) parts.push(`(${size})`);
  if (quant) parts.push(`[${quant}]`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Ollama API client (minimal, fetch-based)
// ---------------------------------------------------------------------------

async function fetchOllamaModels(baseUrl: string, timeoutMs = 10_000): Promise<OllamaModel[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Ollama API returned ${res.status}`);
    const data = (await res.json()) as OllamaTagsResponse;
    return data.models ?? [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchModelContextSize(baseUrl: string, modelName: string): Promise<number | null> {
  try {
    const res = await fetch(`${baseUrl}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as OllamaShowResponse;

    // Check model_info for context length
    const info = data.model_info ?? {};
    for (const [key, value] of Object.entries(info)) {
      if (key.includes("context_length") && typeof value === "number") {
        return value;
      }
    }

    // Check parameters string for num_ctx
    if (data.parameters) {
      const match = data.parameters.match(/num_ctx\s+(\d+)/);
      if (match) return parseInt(match[1], 10);
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provider definition
// ---------------------------------------------------------------------------

export function createOllamaProvider() {
  return {
    id: "ollama",
    label: "Ollama (Local)",
    docsPath: "/providers/models",
    aliases: ["ollama-local"],
    envVars: ["OLLAMA_HOST"],

    auth: [
      {
        id: "local",
        label: "Local Ollama",
        hint: "Auto-discover models from a running Ollama instance",
        kind: "custom" as const,
        run: async (ctx: ProviderAuthContext): Promise<ProviderAuthResult> => {
          // Ask for base URL
          const baseUrlInput = await ctx.prompter.text({
            message: "Ollama base URL",
            initialValue: process.env.OLLAMA_HOST ?? DEFAULT_BASE_URL,
            validate: (value: string) => {
              try {
                new URL(value.trim());
              } catch {
                return "Enter a valid URL (e.g. http://localhost:11434)";
              }
              return undefined;
            },
          });

          const baseUrl = baseUrlInput.trim().replace(/\/+$/, "");

          // Discover models
          const spin = ctx.prompter.progress("Discovering Ollama models...");
          let ollamaModels: OllamaModel[];
          try {
            ollamaModels = await fetchOllamaModels(baseUrl);
          } catch (err) {
            spin.stop("Failed to connect to Ollama");
            await ctx.prompter.note(
              `Could not reach Ollama at ${baseUrl}. Is it running?\n\nStart with: ollama serve`,
              "Connection failed",
            );
            throw err;
          }

          if (ollamaModels.length === 0) {
            spin.stop("No models found");
            await ctx.prompter.note(
              `Ollama is running but has no models.\n\nPull one with: ollama pull llama3.3`,
              "No models",
            );
            throw new Error("No Ollama models available");
          }

          spin.stop(`Found ${ollamaModels.length} model(s)`);

          // Enrich with context sizes from /api/show (parallel, best-effort)
          const contextSizes = await Promise.all(
            ollamaModels.map((m) => fetchModelContextSize(baseUrl, m.name)),
          );

          // Build model definitions
          const models = ollamaModels.map((m, i) => {
            const caps = inferCapabilities(m);
            const actualContext = contextSizes[i] ?? caps.contextWindow;
            return {
              id: m.name,
              name: humanName(m),
              api: "ollama" as const,
              reasoning: caps.reasoning,
              input: caps.input,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: actualContext,
              maxTokens: Math.min(DEFAULT_MAX_TOKENS, Math.floor(actualContext / 4)),
            };
          });

          const defaultModelId = models[0]?.id ?? "llama3.3:latest";
          const defaultModelRef = `ollama/${defaultModelId}`;

          return {
            profiles: [
              {
                profileId: "ollama:local",
                credential: {
                  type: "token" as const,
                  provider: "ollama",
                  token: "ollama", // Ollama needs no real auth
                },
              },
            ],
            configPatch: {
              models: {
                providers: {
                  ollama: {
                    baseUrl,
                    apiKey: "ollama",
                    api: "ollama",
                    authHeader: false,
                    models,
                  },
                },
              },
            },
            defaultModel: defaultModelRef,
            notes: [
              `Registered ${models.length} model(s) from ${baseUrl}`,
              "All inference runs locally — zero cost.",
              "Pull more models with: ollama pull <model-name>",
              "Re-run /login ollama to refresh the model list.",
            ],
          };
        },
      },
    ],
  };
}
