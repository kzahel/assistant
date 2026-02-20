# OpenClaw Architecture Analysis

[OpenClaw](https://github.com/openclaw/openclaw) (~140K GitHub stars) is the most popular open-source personal AI assistant. It runs as a local daemon and uses messaging platforms (Signal, Telegram, Discord, WhatsApp, etc.) as its primary UI. This document is a detailed analysis of its architecture — what's clever, what's limiting, and what informs our own design.

## Overview

OpenClaw is a **gateway-centric runtime**. Everything flows through a long-running server process that manages channel connections, sessions, cron jobs, and agent execution. The gateway is the product — without it running, nothing works.

```
┌─ OpenClaw Gateway (always running) ─────────────────┐
│                                                      │
│  Channel Monitors (listeners)                        │
│  ├── Signal: polling signal-cli                      │
│  ├── Telegram: long-polling Bot API                  │
│  ├── Discord: WebSocket to Discord gateway           │
│  └── ...38+ channel plugins                          │
│                                                      │
│  Session Store (JSONL files on disk)                 │
│  ├── signal:+1234567890.jsonl                        │
│  ├── telegram:user-42.jsonl                          │
│  └── discord:guild-chan-user.jsonl                    │
│                                                      │
│  Agent Runner (calls LLM API per turn)               │
│  Cron Service (croner-based scheduled jobs)          │
│  Memory Service (SQLite + vector embeddings)         │
└──────────────────────────────────────────────────────┘
```

## Channel Delivery

### Auto-reply (implicit, default)

The agent doesn't know or care that it's talking to Signal vs Telegram. It just writes its response text normally. The gateway intercepts the output and auto-routes it back to whichever channel the message came from. The agent doesn't need a "send" tool for basic replies.

### Tool call filtering

When the agent calls `web_search`, `bash`, `browser_snapshot`, etc., none of that appears in the chat. The gateway filters tool calls and results from channel output by default. Only the agent's final text response reaches the user. A verbose mode exists for debugging that shows tool output.

### Block streaming for progress

OpenClaw has a configurable "block streaming" mode where intermediate text chunks are sent to the channel as the agent generates them. The gateway coalesces chunks by character count and idle timeout — so `"Let me check that..."` gets sent immediately, then tool calls happen silently, then `"Found 5 results..."` goes out as the next message.

This is how progress updates work — they're just the agent's normal text output being streamed in blocks, not explicit sends. The coalescing is managed by a `block-reply-coalescer` with configurable min/max chars buffer and idle timeout.

### Explicit message tool

For proactive sends or cross-session messaging, the agent has a built-in `message` tool:

```
message(action="send", to="+1234567890", channel="signal", text="...")
```

The system prompt tells the agent: if you use `message` to deliver your reply, respond with ONLY `🤐` (a silent token) to suppress the auto-reply and avoid duplicate messages.

### System prompt awareness

The agent's system prompt explicitly tells it about the channel context:

```
## Messaging
- Reply in current session → automatically routes to the source channel
- Cross-session messaging → use sessions_send(sessionKey, message)
- If you use `message` (action=send) to deliver your user-visible reply,
  respond with ONLY: 🤐 (avoid duplicate replies)
```

## Gateway Session Model

### Message flow

1. **Channel monitor receives message.** Signal monitor sees: `from: +1234567890, body: "what's trending on HN?"`.

2. **Compute session key.** Based on config, this becomes `signal:+1234567890`. Scoping is configurable:
   - `per-sender` (default for DMs) — each person gets their own conversation
   - `global` — everyone in a group chat shares one session
   - `per-channel-peer` — separate session per channel per person

3. **Load session history.** The gateway reads `~/.openclaw/sessions/signal:+1234567890.jsonl`:
   ```jsonl
   {"role":"user","content":"remind me about the meeting tomorrow","ts":"2026-02-19T09:00:00Z"}
   {"role":"assistant","content":"I'll remind you tomorrow morning.","ts":"2026-02-19T09:00:03Z"}
   {"role":"user","content":"what's trending on HN?","ts":"2026-02-20T14:30:00Z"}
   ```

4. **Build prompt.** `[system prompt] + [conversation history from JSONL] + [new user message]`. Memory search results may be prepended if configured.

5. **Run agent.** LLM generates a response. Tool calls execute in a loop. Block streaming sends chunks to channel if enabled.

6. **Append response.** Assistant's final text appended to JSONL:
   ```jsonl
   {"role":"assistant","content":"Here's what's trending on HN today...","ts":"2026-02-20T14:30:12Z"}
   ```

7. **Route to channel.** Response text sent back via Signal.

### The condensed session format

A key insight: the session JSONL stores **only user inputs and final assistant outputs**. No tool calls, no intermediate reasoning, no chain-of-thought. This is a heavily condensed summary of each turn — the *conclusions* of past work, not the process.

This is clever for two reasons:
- **Token efficient** — loading 50 past turns costs ~50 messages of context, not 50 full agent loops with tool calls
- **Semantically complete** — the next turn gets everything it needs for conversational continuity. The "how" of past work doesn't matter, only the "what"

It's like reading meeting notes vs a full transcript — you lose the process but keep the outcomes.

### Session lifecycle and reset strategies

The JSONL grows with each turn. OpenClaw provides several strategies:

- **Daily reset** at a configured hour (e.g., midnight) — wipes the JSONL, fresh start each day
- **Idle reset** after N minutes of no messages — session clears when the conversation naturally ends
- **Size pruning** — old messages trimmed when file exceeds max size (sliding window)
- **Manual reset** — user sends a trigger word (configurable, like `/reset`)

There's **no summarization** of old messages — it's either "keep the history" or "wipe it." Long-term persistence comes from the separate memory system (vector DB over `MEMORY.md` files), which the agent can query as a tool but which isn't automatically injected into context.

These reset strategies map to real usage patterns:
- Daily reset = "fresh assistant each morning" (casual helper)
- Idle reset = "task-scoped conversation" (clears between tasks)
- No reset + size pruning = "continuous relationship" (sliding window of recent history)

### Cost model

Every incoming message incurs the full token cost of the conversation history. A 50-message conversation means the LLM re-reads all 50 messages on turn 51. No incremental context or caching across turns — each turn is a fresh API call with the full history.

Fine for short conversations (messaging tends to be brief exchanges) but gets expensive for long-running sessions. The reset strategies are partly a cost management mechanism.

## Message Concurrency

### Strictly queued, no steering, no batching

When multiple messages arrive while the agent is processing, they're handled by a `ChatRunRegistry` — a per-session FIFO queue (`Map<sessionId, ChatRunEntry[]>`).

```
You: "check HN"             → agent starts processing
You: "also check reddit"    → queued (waits)
You: "never mind, skip HN"  → queued (waits)
```

The agent fully processes "check HN", then processes "also check reddit" as a separate turn, then processes "never mind, skip HN" — by which point HN was already checked. Each message is an independent job. There's no way to steer or amend an in-flight request.

### Deduplication

Messages are deduplicated via `idempotencyKey`. If the same key arrives twice, the cached response is returned. This prevents retransmission issues but doesn't help with the queuing problem.

### Cancellation via /stop

The only escape hatch is `/stop` — which aborts the current run via `AbortController`, saves partial output to the transcript with abort metadata, and lets the next queued message proceed.

### No batching

Each message is processed independently. If 3 messages arrive in 5 seconds while the agent is busy, they become 3 separate sequential runs, not one batched request. The agent on turn 2 sees message 1's response in its history, but it can't see messages 3 (still queued).

### Key data structures

| Structure | Purpose |
|-----------|---------|
| `chatRunSessions: Map<sessionId, ChatRunEntry[]>` | FIFO queue per session |
| `chatAbortControllers: Map<runId, AbortController>` | Track/cancel active runs |
| `dedupe: Map<idempotencyKey, DedupeEntry>` | Prevent duplicate requests (5min TTL) |
| `chatRunBuffers: Map<runId, string>` | Buffer assistant text for streaming |
| `chatAbortedRuns: Map<runId, timestamp>` | Track aborted runs (60min cleanup) |

A maintenance timer runs every 60 seconds to clean up expired entries.

### Implications

This is a significant limitation for conversational use. In real chat, you often want to clarify or redirect mid-thought. OpenClaw treats each message as an independent job — reliable but not conversational.

## Plugin System

### Manifest format

Plugins are defined by `openclaw.plugin.json`:

```json
{
  "id": "voice-call",
  "channels": ["voice-call"],
  "providers": [],
  "skills": [],
  "configSchema": { "type": "object", ... },
  "uiHints": { ... }
}
```

### Discovery and loading

- Gateway scans `extensions/` directory for manifests at startup
- Plugins are loaded at runtime via **jiti** (a TypeScript runtime loader — like `tsx` but as a library, used for programmatic `import()` of TypeScript without a build step)
- Config validated against each plugin's JSON Schema via Ajv
- Plugin management CLI: `openclaw plugins install|enable|update|uninstall`

### Hook system

Plugins can register hooks at various lifecycle points:
- `beforeAgentStart` — inject system prompt, override model
- `beforePromptBuild` — prepend context to messages
- `beforeModelResolve` — override model selection
- Various channel-specific hooks

### Key limitation

Skills/plugins are TypeScript modules tightly coupled to the OpenClaw runtime. They can't function outside the gateway. A plugin that knows how to check Gmail is useless without the daemon running.

## Identity and Personality

### Structured config, not freeform prompt

Identity is config fields in `openclaw.json`:

```typescript
type IdentityConfig = {
  name?: string;    // "Claude"
  emoji?: string;   // Identity emoji reaction
}
```

Resolved at multiple levels: agent → channel account → channel → global. The name appears as a `[ClaudeName]` message prefix. Acknowledgment emoji defaults to identity emoji.

There's no `soul.md` equivalent — no place for rich personality description, communication style preferences, or relationship context. Identity is functional (name, emoji, prefix) not characterful.

## Memory

### Dual-layered

1. **MEMORY.md** — agent-controlled plaintext file. Agent reads/writes it like Claude Code's MEMORY.md
2. **Vector DB** — SQLite-backed with embeddings for semantic search. Agent can call `memory_search` tool

### Agent self-modification

Agents can edit `MEMORY.md` and auxiliary `memory/*.md` files. They **cannot** edit `openclaw.json` config. This is a deliberate choice — memory is agent-controlled, config is admin-controlled.

## Configuration

### Single file, JSON5

Everything in `~/.openclaw/openclaw.json` (JSON5 — allows comments, trailing commas). Channels, agents, plugins, cron, memory, gateway settings — all in one file. Validated via Zod schemas internally + JSON Schema for plugin config.

### Multi-agent support

Multiple agents defined in `agents.list[]`, each with their own model, tools, identity, sandbox settings. Per-session routing maps channel+sender to agent. Sub-agent spawning with max ping-pong turns.

## Scheduling

### CronService with croner

Job types:
```typescript
type CronSchedule =
  | { kind: "at"; at: string }                    // One-shot at absolute time
  | { kind: "every"; everyMs: number }             // Recurring interval
  | { kind: "cron"; expr: string; tz?: string }    // Cron expression
```

Jobs have delivery modes (`announce` to channel, `webhook`, or `none`), session targeting (`main` or `isolated`), and state tracking (`consecutiveErrors`, backoff, auto-disable).

Staggering via deterministic hash prevents thundering herd when multiple jobs share the same cron expression.

State persisted to `~/.openclaw/cron-store.json`.

## What We Learn From OpenClaw

### Borrow

1. **Schedule state tracking** — `consecutiveErrors`, `lastRunAt`, auto-disable after repeated failures
2. **Condensed session format** — storing only user/assistant messages (no tool calls) is the right compression for conversation history
3. **Reset strategies** — daily, idle, size-based, manual. These map to real usage patterns
4. **Activity logging** — structured records of what the assistant did

### Avoid

1. **Gateway dependency** — everything requiring a running daemon limits portability
2. **Plugin lock-in** — skills that only work inside one runtime
3. **No message batching** — strictly sequential processing means rapid-fire messages can't be coalesced
4. **Monolithic config** — one giant JSON file mixing channels, agents, plugins, cron, memory settings
5. **Structured-only identity** — name + emoji is too limited for rich personality

### Open questions their architecture raises for us

1. **Session continuity in channel mode** — when someone texts 3 times in 10 minutes, should each be a fresh session? Or should we maintain lightweight continuity via a file the assistant reads?
2. **Message batching** — if a listener daemon receives multiple messages while spawning a session, should it coalesce them into one prompt? (Probably yes — matches how humans text in bursts)
3. **Auto-routing vs explicit send** — their auto-routing is elegant when a gateway exists. Our explicit-send is safer (no accidental dumps) but more prompt burden. For a future listener daemon, reconsider.
