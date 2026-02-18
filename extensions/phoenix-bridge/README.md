# Phoenix Bridge for Clawdbot

Bridge between Clawdbot and Phoenix AGI system, enabling autonomous task execution, distributed cluster operations, and persistent memory across all messaging channels.

## Features

- **Phoenix Memory Integration** - 4-tier persistent memory with semantic search
- **Cluster Execution** - Distributed task execution across 4-node Mac cluster
- **Prometheus Agent Loop** - Autonomous planning, execution, and verification
- **Cross-Channel Access** - Use Phoenix from WhatsApp, Telegram, Slack, Discord, etc.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CLAWDBOT                             │
│   WhatsApp │ Telegram │ Slack │ Discord │ iOS │ Mac    │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│                  PHOENIX BRIDGE                         │
│   • phoenix_memory_store    • phoenix_cluster_execute   │
│   • phoenix_memory_search   • phoenix_cluster_status    │
│   • phoenix_memory_recall   • phoenix_offload           │
│   • phoenix_execute_task    • phoenix_create_goal       │
│   • phoenix_agent_status                                │
└───────────────────────┬─────────────────────────────────┘
                        │ MCP Protocol (stdio)
┌───────────────────────▼─────────────────────────────────┐
│                  PHOENIX MCP SERVERS                    │
│   enhanced-memory-mcp │ cluster-execution-mcp │         │
│   agent-runtime-mcp   │ prometheus agent loop │         │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│                  PHOENIX CLUSTER                        │
│   mac-studio │ macbook-air │ macmini │ macpro51    │
└─────────────────────────────────────────────────────────┘
```

## Installation

The extension is included in Clawdbot. Enable it in your config:

```yaml
# ~/.clawdbot/config.yaml
plugins:
  phoenix-bridge:
    enabled: true
    mcpServers:
      enhancedMemory:
        enabled: true
      clusterExecution:
        enabled: true
      agentRuntime:
        enabled: true
```

## Tools

### Memory Tools

#### `phoenix_memory_store`

Store information in Phoenix persistent memory.

```
Store this for later: Meeting with John at 3pm about the API design
→ Stored in Phoenix memory: clawdbot-1234567890
```

#### `phoenix_memory_search`

Semantic search across all stored memories.

```
Search my memories for API discussions
→ Found 5 memories matching "API discussions"
```

#### `phoenix_memory_recall`

Quick recall using NMF patterns.

```
What did we discuss about authentication?
→ [Recalls relevant memories about authentication]
```

### Cluster Tools

#### `phoenix_cluster_execute`

Execute commands on the Phoenix cluster with automatic routing.

```
Run the test suite on the cluster
→ Executed on macpro51 (exit 0): All 127 tests passed
```

#### `phoenix_cluster_status`

Check cluster node health and load.

```
What's the cluster status?
→ mac-studio (orchestrator): healthy - Load: 12%
  macbook-air (researcher): healthy - Load: 8%
  ...
```

#### `phoenix_offload`

Offload specific tasks to specific nodes.

```
Build the Docker image on the Linux node
→ Offloaded to macpro51 (exit 0): Image built successfully
```

### Agent Tools

#### `phoenix_execute_task`

Execute complex tasks via Prometheus agent loop.

```
Analyze our codebase and create a refactoring plan
→ Task completed: Created 12-step refactoring plan...
```

#### `phoenix_create_goal`

Create persistent goals that survive sessions.

```
Create a goal to improve test coverage to 90%
→ Goal created: Improve Test Coverage
  ID: goal-abc123
  Priority: 7
```

#### `phoenix_agent_status`

Check agent status and active goals.

```
What are my active goals?
→ Phoenix Agent Status:
  • [active] Improve Test Coverage: Increase test coverage...
  • [active] API Documentation: Complete API docs...
```

## CLI Commands

```bash
# Check Phoenix system status
clawdbot phoenix status

# Execute a task
clawdbot phoenix execute "analyze the login flow for security issues"

# Get cluster status
clawdbot phoenix cluster

# Memory operations
clawdbot phoenix memory store "Important fact to remember"
clawdbot phoenix memory search "authentication"
clawdbot phoenix memory recall "what we discussed"
```

## Gateway Methods

For WebSocket clients:

```javascript
// Get Phoenix status
ws.send({ method: "phoenix.status" });

// Execute a task
ws.send({ method: "phoenix.execute", params: { task: "..." } });

// Search memory
ws.send({ method: "phoenix.memory.search", params: { query: "..." } });
```

## Configuration

```yaml
plugins:
  phoenix-bridge:
    enabled: true

    # MCP server configuration
    mcpServers:
      enhancedMemory:
        enabled: true
        command: python
        args: ["/path/to/enhanced-memory-mcp/server.py"]

      clusterExecution:
        enabled: true
        command: python
        args: ["/path/to/cluster-execution-mcp/server.py"]

      agentRuntime:
        enabled: true
        command: python
        args: ["/path/to/agent-runtime-mcp/server.py"]

    # Optional: HTTP endpoint for Prometheus agent loop
    prometheusEndpoint: http://localhost:8080/prometheus

    # Cluster node definitions
    clusterNodes:
      - id: mac-studio
        host: mac-studio.local
        role: orchestrator
      - id: macbook-air
        host: macbook-air.local
        role: researcher
      - id: macmini
        host: macmini.local
        role: developer
      - id: macpro51
        host: macpro51.local
        role: builder
```

## Development

```bash
# Install dependencies
cd extensions/phoenix-bridge
pnpm install

# Test the extension
pnpm test

# Build
pnpm build
```

## Related

- [Phoenix AGI System](../../README.md)
- [enhanced-memory-mcp](../../mcp-servers/enhanced-memory-mcp/)
- [cluster-execution-mcp](../../mcp-servers/cluster-execution-mcp/)
- [agent-runtime-mcp](../../mcp-servers/agent-runtime-mcp/)
- [Prometheus Agent](../../intelligent-agents/prometheus/)
