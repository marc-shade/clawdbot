# Phoenix Bridge v2 Design

**Date**: 2026-02-18
**Status**: Implemented
**Commit**: `a0ddb5519`

## Problem

The phoenix-bridge extension was using 3 of 11 OpenClaw registration APIs (`registerTool` only) and 0 of 20 lifecycle hooks. The extension also used pre-rebrand naming (`clawdbot` imports, `ClawdbotPluginApi` types, `clawdbot.plugin.json` manifest). After 4,292 upstream commits, the gap between available capabilities and actual usage was significant.

## Goals

1. Complete the `clawdbot` to `openclaw` rebrand across all extension files
2. Leverage OpenClaw's hook system for memory injection, session persistence, and tool safety
3. Add service lifecycle management via `registerService`
4. Expose Phoenix operations through slash commands and gateway WebSocket methods
5. Make all features configurable via plugin config toggles

## Architecture

```
extensions/phoenix-bridge/
  index.ts                       # Plugin entry — registers all 6 API surfaces
  openclaw.plugin.json           # Plugin manifest with feature toggle schema
  package.json                   # @openclaw/phoenix-bridge, workspace dep
  src/
    phoenix-client.ts            # MCP stdio client (3 servers)
    service.ts                   # registerService lifecycle (start/stop)
    hooks/
      memory-inject.ts           # before_agent_start — inject relevant memories
      session-persist.ts         # agent_end, session_end, after_compaction
      tool-guard.ts              # before_tool_call (Ember gating), after_tool_call (logging)
    tools/
      memory.ts                  # 3 tools: store, search, recall
      cluster.ts                 # 3 tools: execute, status, offload
      agent.ts                   # 3 tools: execute_task, create_goal, agent_status
    channel/
      phoenix-channel.ts         # ChannelPlugin definition (assembles adapters)
      config-adapter.ts          # Account management (single default account)
      gateway-adapter.ts         # startAccount/stopAccount (polls agent-runtime)
      outbound-adapter.ts        # sendText → enhanced-memory storage
      status-adapter.ts          # probeAccount → MCP server health
```

## API Surface Coverage

| OpenClaw API            | Used | Purpose                                      |
| ----------------------- | ---- | -------------------------------------------- |
| `registerTool`          | Yes  | 9 tools across memory, cluster, agent        |
| `registerService`       | Yes  | MCP client lifecycle (start/stop)            |
| `registerCommand`       | Yes  | `/phoenix` slash command                     |
| `registerCli`           | Yes  | `openclaw phoenix <subcommand>` terminal CLI |
| `registerGatewayMethod` | Yes  | 12 WebSocket endpoints                       |
| `on()` hooks            | Yes  | 6 lifecycle hooks                            |
| `registerHook`          | No   | Covered by `on()`                            |
| `registerHttpHandler`   | No   | Not needed                                   |
| `registerHttpRoute`     | No   | Not needed                                   |
| `registerChannel`       | Yes  | Phoenix as messaging channel (direct chat)   |
| `registerProvider`      | No   | Not applicable                               |

## Hook Integration

| Hook Event           | Handler                     | Behavior                                                                                                                                       |
| -------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `before_agent_start` | `createMemoryInjectHook`    | Searches enhanced-memory for prompt-relevant entities, returns `prependContext` with formatted memories                                        |
| `agent_end`          | `createAgentEndHook`        | Extracts last assistant message as summary, stores session outcome with success/failure metadata                                               |
| `session_end`        | `createSessionEndHook`      | Stores session lifecycle event (message count, duration)                                                                                       |
| `after_compaction`   | `createAfterCompactionHook` | Records compaction metrics to memory                                                                                                           |
| `before_tool_call`   | `createBeforeToolCallHook`  | Checks sensitive tools (bash, write_file, delete, deploy, send_message) against Ember `ember_check_violation`. Fails open if Ember unavailable |
| `after_tool_call`    | `createAfterToolCallHook`   | Records tool usage to Thunder observation system for pattern learning                                                                          |

## Gateway Methods

| Method                      | Description                   |
| --------------------------- | ----------------------------- |
| `phoenix.status`            | System connection status      |
| `phoenix.execute`           | Task execution via Prometheus |
| `phoenix.memory.search`     | Semantic memory search        |
| `phoenix.memory.store`      | Store to enhanced-memory      |
| `phoenix.memory.recall`     | NMF pattern recall            |
| `phoenix.cluster.status`    | Cluster node status           |
| `phoenix.cluster.execute`   | Execute on cluster            |
| `phoenix.cluster.offload`   | Offload to specific node      |
| `phoenix.agent.goals`       | List active goals             |
| `phoenix.agent.goal.create` | Create persistent goal        |
| `phoenix.agent.task.next`   | Get next available task       |

All gateway methods use the `({ params, respond }) => void` pattern per `GatewayRequestHandler` contract.

## Configuration

Three feature toggles in `openclaw.plugin.json`, all default `true`:

| Flag                    | Controls                                               |
| ----------------------- | ------------------------------------------------------ |
| `enableMemoryInjection` | `before_agent_start` hook                              |
| `enableSessionPersist`  | `agent_end` + `session_end` + `after_compaction` hooks |
| `enableToolGuard`       | `before_tool_call` + `after_tool_call` hooks           |

## Channel Integration

Phoenix is registered as a `ChannelPlugin` with id `"phoenix"`, making it accessible through OpenClaw's channel management system alongside Telegram, Slack, Discord, etc.

### Adapters

| Adapter    | File                           | Behavior                                                                                        |
| ---------- | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `config`   | `config-adapter.ts`            | Single "default" account, always configured (uses phoenix-bridge MCP client)                    |
| `gateway`  | `gateway-adapter.ts`           | `startAccount` polls agent-runtime for ready/blocked tasks every 30s; `stopAccount` sets status |
| `outbound` | `outbound-adapter.ts`          | `sendText` stores agent responses to enhanced-memory as `openclaw_channel_response` entities    |
| `status`   | `status-adapter.ts`            | `probeAccount` checks all 3 MCP server connections; `buildAccountSnapshot` reports health       |
| `security` | Inline in `phoenix-channel.ts` | DM policy = `"open"` (trusted local system channel)                                             |

### Capabilities

Direct chat only (`chatTypes: ["direct"]`), no reactions/threads/media/polls. Block streaming enabled (wait for full response before dispatching).

### What This Enables

- `openclaw channels phoenix status` — Phoenix connection health in OpenClaw CLI
- `openclaw channels phoenix enable/disable` — Toggle event routing
- Proactive agent engagement — Phoenix events trigger agent conversations
- Unified message history — Phoenix interactions in same session store as other channels
- Channel routing — Route Phoenix events to specific agent routes

## Design Decisions

**Inline types for hook handlers**: The plugin SDK exports `OpenClawPluginApi` but not hook event types (`PluginHookBeforeAgentStartEvent`, etc.). Rather than importing from internal paths, each hook file defines its own minimal inline types matching the expected signatures. This is resilient to SDK refactors.

**Fail-open for Ember integration**: The tool guard catches all errors from `ember_check_violation` and allows the tool call to proceed. A safety system that blocks legitimate work when a subsystem is down causes more harm than the risk it mitigates.

**`respond()` instead of return**: Gateway methods use `respond(success, data)` instead of returning values, matching the `GatewayRequestHandler` contract where the handler returns `void`.

**`label` field on all tools**: The upstream `AgentTool` interface (from `@mariozechner/pi-agent-core`) requires a `label: string` field. Added to all 9 tools.

**`as ChannelPlugin` cast for registerChannel**: The `registerChannel` API expects `ChannelPlugin` with default generic parameters (`any, unknown, unknown`). Our typed `ChannelPlugin<ResolvedPhoenixAccount, PhoenixProbe>` is structurally compatible but TypeScript's generic variance rules reject it. The cast follows the same pattern used by the Telegram extension (`telegramPlugin as ChannelPlugin`).

## Verification

- TypeScript: 0 errors in `extensions/phoenix-bridge/` with project tsconfig
- Module resolution: `"openclaw/plugin-sdk"` resolves via tsconfig `paths` mapping
- No regressions: all pre-existing project errors are outside phoenix-bridge
