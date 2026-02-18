/**
 * Phoenix MCP Client
 *
 * Connects OpenClaw to Phoenix AGI system via MCP protocol.
 * Supports three core MCP servers:
 * - enhanced-memory-mcp: 4-tier persistent memory with RAG
 * - cluster-execution-mcp: Distributed task execution across nodes
 * - agent-runtime-mcp: Persistent goals and task management
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import * as path from "node:path";
import * as readline from "node:readline";

export type PhoenixConfig = {
  socketPath?: string;
  mcpServers?: {
    enhancedMemory?: {
      enabled?: boolean;
      command?: string;
      args?: string[];
    };
    clusterExecution?: {
      enabled?: boolean;
      command?: string;
      args?: string[];
    };
    agentRuntime?: {
      enabled?: boolean;
      command?: string;
      args?: string[];
    };
  };
  prometheusEndpoint?: string;
  clusterNodes?: Array<{
    id: string;
    host: string;
    role: "orchestrator" | "researcher" | "developer" | "builder";
  }>;
};

export type PhoenixLogger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type McpRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

type McpResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type McpServerConnection = {
  process: ChildProcess;
  rl: readline.Interface;
  pending: Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>;
  nextId: number;
};

export class PhoenixMcpClient extends EventEmitter {
  private logger: PhoenixLogger;
  private getConfig: () => PhoenixConfig;
  private connections: Map<string, McpServerConnection> = new Map();
  private initialized = false;

  // Default paths for Phoenix MCP servers
  private static readonly DEFAULT_PATHS = {
    agenticSystem: process.env.STORAGE_BASE || "/Volumes/SSDRAID0/agentic-system",
    mcpServers: "mcp-servers",
  };

  constructor(opts: { logger: PhoenixLogger; getConfig: () => PhoenixConfig }) {
    super();
    this.logger = opts.logger;
    this.getConfig = opts.getConfig;
  }

  /**
   * Initialize connections to Phoenix MCP servers
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const config = this.getConfig();
    const basePath = path.join(
      PhoenixMcpClient.DEFAULT_PATHS.agenticSystem,
      PhoenixMcpClient.DEFAULT_PATHS.mcpServers,
    );

    // Start enhanced-memory-mcp
    if (config.mcpServers?.enhancedMemory?.enabled !== false) {
      await this.startMcpServer("enhanced-memory", {
        command: config.mcpServers?.enhancedMemory?.command || "python",
        args: config.mcpServers?.enhancedMemory?.args || [
          path.join(basePath, "enhanced-memory-mcp", "server.py"),
        ],
      });
    }

    // Start cluster-execution-mcp
    if (config.mcpServers?.clusterExecution?.enabled !== false) {
      await this.startMcpServer("cluster-execution", {
        command: config.mcpServers?.clusterExecution?.command || "python",
        args: config.mcpServers?.clusterExecution?.args || [
          path.join(basePath, "cluster-execution-mcp", "server.py"),
        ],
      });
    }

    // Start agent-runtime-mcp
    if (config.mcpServers?.agentRuntime?.enabled !== false) {
      await this.startMcpServer("agent-runtime", {
        command: config.mcpServers?.agentRuntime?.command || "python",
        args: config.mcpServers?.agentRuntime?.args || [
          path.join(basePath, "agent-runtime-mcp", "server.py"),
        ],
      });
    }

    this.initialized = true;
    this.logger.info("Phoenix MCP client initialized");
  }

  /**
   * Start an MCP server process and establish stdio communication
   */
  private async startMcpServer(
    name: string,
    opts: { command: string; args: string[] },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const proc = spawn(opts.command, opts.args, {
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            PYTHONUNBUFFERED: "1",
          },
        });

        const rl = readline.createInterface({
          input: proc.stdout!,
          crlfDelay: Infinity,
        });

        const connection: McpServerConnection = {
          process: proc,
          rl,
          pending: new Map(),
          nextId: 1,
        };

        // Handle responses
        rl.on("line", (line) => {
          try {
            const response = JSON.parse(line) as McpResponse;
            const pending = connection.pending.get(response.id);
            if (pending) {
              connection.pending.delete(response.id);
              if (response.error) {
                pending.reject(new Error(response.error.message));
              } else {
                pending.resolve(response.result);
              }
            }
          } catch (err) {
            this.logger.debug?.(`[${name}] Parse error: ${err}`);
          }
        });

        // Handle stderr
        proc.stderr?.on("data", (data) => {
          this.logger.debug?.(`[${name}] stderr: ${data.toString()}`);
        });

        // Handle process exit
        proc.on("exit", (code) => {
          this.logger.warn(`[${name}] MCP server exited with code ${code}`);
          this.connections.delete(name);
        });

        proc.on("error", (err) => {
          this.logger.error(`[${name}] MCP server error: ${err.message}`);
          reject(err);
        });

        this.connections.set(name, connection);

        // Send initialize request
        this.sendRequest(name, "initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "openclaw-phoenix-bridge",
            version: "2026.2.18",
          },
        })
          .then(() => {
            this.logger.info(`[${name}] MCP server connected`);
            resolve();
          })
          .catch(reject);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Send a request to an MCP server
   */
  private sendRequest(
    serverName: string,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const connection = this.connections.get(serverName);
      if (!connection) {
        reject(new Error(`MCP server not connected: ${serverName}`));
        return;
      }

      const id = connection.nextId++;
      const request: McpRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      connection.pending.set(id, { resolve, reject });

      try {
        connection.process.stdin?.write(JSON.stringify(request) + "\n");
      } catch (err) {
        connection.pending.delete(id);
        reject(err);
      }

      // Timeout after 30 seconds
      setTimeout(() => {
        if (connection.pending.has(id)) {
          connection.pending.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  /**
   * Call an MCP tool
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    await this.initialize();
    return this.sendRequest(serverName, "tools/call", {
      name: toolName,
      arguments: args,
    });
  }

  // ============================================================================
  // Memory Operations (enhanced-memory-mcp)
  // ============================================================================

  async memoryStore(content: string, metadata?: Record<string, unknown>): Promise<unknown> {
    return this.callTool("enhanced-memory", "create_entities", {
      entities: [
        {
          name: `openclaw-${Date.now()}`,
          entityType: "openclaw_memory",
          observations: [content],
          metadata: {
            source: "openclaw",
            timestamp: new Date().toISOString(),
            ...metadata,
          },
        },
      ],
    });
  }

  async memorySearch(query: string, limit = 10): Promise<unknown> {
    return this.callTool("enhanced-memory", "search_nodes", {
      query,
      limit,
    });
  }

  async memoryRecall(query: string): Promise<unknown> {
    return this.callTool("enhanced-memory", "nmf_recall", {
      query,
    });
  }

  // ============================================================================
  // Cluster Operations (cluster-execution-mcp)
  // ============================================================================

  async clusterExecute(command: string, nodeId?: string): Promise<unknown> {
    if (nodeId) {
      return this.callTool("cluster-execution", "offload_to", {
        node_id: nodeId,
        command,
      });
    }
    return this.callTool("cluster-execution", "cluster_bash", {
      command,
    });
  }

  async getClusterStatus(): Promise<unknown> {
    return this.callTool("cluster-execution", "cluster_status", {});
  }

  async offloadTask(nodeId: string, command: string): Promise<unknown> {
    return this.callTool("cluster-execution", "offload_to", {
      node_id: nodeId,
      command,
    });
  }

  // ============================================================================
  // Agent Operations (agent-runtime-mcp)
  // ============================================================================

  async createGoal(name: string, description: string): Promise<unknown> {
    return this.callTool("agent-runtime", "create_goal", {
      name,
      description,
    });
  }

  async createTask(
    goalId: string,
    name: string,
    description: string,
    dependencies?: string[],
  ): Promise<unknown> {
    return this.callTool("agent-runtime", "create_task", {
      goal_id: goalId,
      name,
      description,
      dependencies,
    });
  }

  async getNextTask(goalId?: string): Promise<unknown> {
    return this.callTool("agent-runtime", "get_next_task", {
      goal_id: goalId,
    });
  }

  async updateTaskStatus(
    taskId: string,
    status: "pending" | "in_progress" | "completed" | "failed",
    result?: string,
  ): Promise<unknown> {
    return this.callTool("agent-runtime", "update_task_status", {
      task_id: taskId,
      status,
      result,
    });
  }

  // ============================================================================
  // Prometheus Agent Loop (HTTP endpoint)
  // ============================================================================

  async executeTask(opts: {
    task: string;
    maxIterations?: number;
    parallel?: boolean;
  }): Promise<unknown> {
    const config = this.getConfig();
    const endpoint = config.prometheusEndpoint;

    if (endpoint) {
      // Use HTTP endpoint if configured
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: opts.task,
          max_iterations: opts.maxIterations ?? 20,
          execution_mode: opts.parallel ? "parallel" : "sequential",
        }),
      });

      if (!response.ok) {
        throw new Error(`Prometheus execution failed: ${response.statusText}`);
      }

      return response.json();
    }

    // Fallback: Create a goal and let agent-runtime handle it
    const goal = await this.createGoal(`Task: ${opts.task.slice(0, 50)}`, opts.task);
    return goal;
  }

  // ============================================================================
  // System Status
  // ============================================================================

  async getSystemStatus(): Promise<{
    memory: { connected: boolean; status?: unknown };
    cluster: { connected: boolean; status?: unknown };
    agent: { connected: boolean; status?: unknown };
  }> {
    const status = {
      memory: { connected: false, status: undefined as unknown },
      cluster: { connected: false, status: undefined as unknown },
      agent: { connected: false, status: undefined as unknown },
    };

    try {
      await this.initialize();

      if (this.connections.has("enhanced-memory")) {
        status.memory.connected = true;
        status.memory.status = await this.callTool("enhanced-memory", "get_memory_status", {});
      }

      if (this.connections.has("cluster-execution")) {
        status.cluster.connected = true;
        status.cluster.status = await this.getClusterStatus();
      }

      if (this.connections.has("agent-runtime")) {
        status.agent.connected = true;
        status.agent.status = await this.callTool("agent-runtime", "list_goals", {});
      }
    } catch (err) {
      this.logger.error(`Failed to get system status: ${err}`);
    }

    return status;
  }

  /**
   * Cleanup and close all connections
   */
  async close(): Promise<void> {
    for (const [name, connection] of this.connections) {
      try {
        connection.process.kill();
        connection.rl.close();
        this.logger.info(`[${name}] MCP server closed`);
      } catch (err) {
        this.logger.error(`[${name}] Error closing: ${err}`);
      }
    }
    this.connections.clear();
    this.initialized = false;
  }
}
