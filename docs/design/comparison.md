# Comparison with Existing Projects

## The Landscape

The AI assistant/agent space has converged on a few standards, mostly under the [Agentic AI Foundation (AAIF)](https://aaif.io/) at the Linux Foundation (founded Dec 2025 by Anthropic, OpenAI, Google, Microsoft, Block, Amazon, Cloudflare):

| Standard | What it defines | Portable? | Our relationship |
|----------|----------------|-----------|-----------------|
| **[SKILL.md](https://agentskills.io/specification)** | Individual skill capabilities | Yes — Claude, Codex, Copilot, Gemini, Goose, Cursor | **We adopt this** for skill definitions |
| **[AGENTS.md](https://agents.md/)** | Project context for coding agents | Yes — 60k+ repos | Similar role to our `CLAUDE.md` but for projects, not assistants |
| **[MCP](https://modelcontextprotocol.io/)** | Tool/resource protocol (JSON-RPC) | Yes — industry standard | Complementary — skills can reference MCP servers |
| **[A2A Agent Card](https://a2a-protocol.org/)** | Agent identity for network discovery | Yes — JSON at `/.well-known/agent-card.json` | Interesting but network-oriented, not filesystem |
| **[Oracle Agent Spec](https://github.com/oracle/agent-spec)** | Full agent + workflow in YAML | Yes — framework-agnostic | Different modeling paradigm — see detailed comparison below |
| **[Docker cagent](https://github.com/docker/cagent)** | Agent teams as YAML + OCI artifacts | Yes — provider-agnostic | Closest to "assistant as data" but team-oriented |

### The gap we fill

**No standard defines a portable "assistant instance" as a filesystem convention.**

- SKILL.md defines skills but not the assistant that uses them
- AGENTS.md defines project context but not persona/identity/scheduling
- A2A Agent Card defines agent identity as JSON but for network discovery, not local use
- Oracle Agent Spec defines agents + workflows in YAML but models a different paradigm (structured execution vs conversational identity)

What doesn't exist is:

```
~/assistants/my-helper/
├── CLAUDE.md           # Entry point — any Claude session knows what to do
├── soul.md             # Personality
├── config.yaml         # Skills, schedules, preferences
├── memory/             # Self-recorded history
└── state/              # Skill checkpoints
```

...where any harness (Claude CLI, Yep Anywhere, Codex, Goose) can discover and load the assistant. That's what this format provides.

## Comparison with OpenClaw

[OpenClaw](https://github.com/openclaw/openclaw) (~140K GitHub stars) is the most popular open-source personal AI assistant — a local daemon that uses messaging platforms as its UI. See **[openclaw-analysis.md](openclaw-analysis.md)** for a detailed deep dive into its gateway architecture, session model, channel delivery, message concurrency, and plugin system.

### Summary comparison

| Aspect | OpenClaw | Assistant Format |
|--------|----------|-----------------|
| **Core abstraction** | Runtime/daemon with plugin system | Directory convention with file schemas |
| **Identity** | Config fields (`identity.name`, `identity.emoji`) | `soul.md` — freeform markdown prompt |
| **Skills** | Plugin packages loaded via jiti at runtime | SKILL.md (cross-tool standard). No loader |
| **Sessions** | Persistent JSONL per session key, managed by gateway | Not opinionated — harness decides |
| **Self-modification** | Agent can edit `MEMORY.md` but NOT config | Agent can edit anything, gated by lint + commit |
| **Messaging** | Core feature — 38+ channel plugins, auto-routing | Channel mode via explicit send command |
| **Portability** | Locked to OpenClaw daemon | Any Claude session, any harness |

### Key architectural insights

**Channel delivery:** Agent output auto-routes to the originating channel. Tool calls are filtered out. Block streaming sends progress as text chunks. Our explicit-send model is safer (no accidental dumps) but puts more burden on the prompt. See [openclaw-analysis.md § Channel Delivery](openclaw-analysis.md#channel-delivery).

**Session model:** One JSONL file per conversation thread, storing only user/assistant messages (no tool calls). Clever compression — token-efficient and semantically complete. Configurable resets: daily, idle, size-based, manual. See [openclaw-analysis.md § Gateway Session Model](openclaw-analysis.md#gateway-session-model).

**Message concurrency:** Strictly queued FIFO per session — no steering, no batching. Rapid-fire messages wait their turn. Only escape is `/stop` to abort current run. This is a significant limitation for conversational use. See [openclaw-analysis.md § Message Concurrency](openclaw-analysis.md#message-concurrency).

### What we borrow

1. Schedule state tracking (`consecutiveErrors`, `lastRunAt`, auto-disable)
2. Condensed session format (user/assistant only, no tool calls)
3. Activity logging as structured JSONL
4. The concept of persistent agent-controlled memory files
5. Soul/identity as a first-class concept

### What we explicitly don't do

1. Plugin system — no manifest, no loader, no lifecycle hooks
2. Gateway server — no HTTP API, no WebSocket, no admin endpoints
3. Multi-agent routing — each instance is independent
4. Channel multiplexing — one channel per invocation
5. Model management — the harness picks the model

### Our session strategy (informed by OpenClaw)

**MVP:** Each channel message spawns a fresh Claude session. No persistent chat history. Context comes from files on disk (soul, config, memory, activity log).

**Future:** Lightweight session continuity via a channel history file the assistant reads — OpenClaw's conversational continuity without a gateway. Message batching (coalesce rapid-fire messages within a time window before spawning a session) to handle how humans actually text in bursts.

## Comparison with Fabric

[Fabric](https://github.com/danielmiessler/Fabric) by Daniel Miessler is a framework where "Patterns" are the core unit — system prompts stored as `system.md` files.

| Aspect | Fabric | Assistant Format |
|--------|--------|-----------------|
| **Skill unit** | `patterns/{name}/system.md` | `skills/{name}/SKILL.md` (Agent Skills standard) |
| **Metadata** | None — no frontmatter, no schema | YAML frontmatter (`name`, `description`) for indexing |
| **Identity** | None — patterns are stateless | `soul.md` per instance |
| **Config** | None — patterns are self-contained | `config.yaml` with per-skill settings |
| **Memory** | None | Activity logs + learnings |
| **Portability** | Portable (just text files) but informal | Portable + standard (SKILL.md spec) |

Fabric is the closest precedent to "skills as markdown prompts in a filesystem convention." The key differences: we add metadata for discovery, instance-level identity, and scheduling.

## Comparison with Oracle Agent Spec

[Oracle Agent Spec](https://github.com/oracle/agent-spec) is a framework-agnostic declarative language for defining agents and workflows in YAML/JSON. It's well-designed and deserves a fair comparison rather than dismissal.

### What Agent Spec models

A minimal agent is actually concise:

```yaml
component_type: Agent
name: My Assistant
system_prompt: You are a helpful assistant.
llm_config:
  component_type: OpenAiConfig
  name: gpt-4o
  model_id: gpt-4o
```

The spec also defines **Flows** (structured workflow graphs with nodes and edges), **Swarm** (agents hand off to each other), and **ManagerWorkers** (delegation patterns). Tools are typed interfaces with JSON Schema I/O.

### Where Agent Spec is stronger

| Capability | Agent Spec | Our format |
|------------|-----------|------------|
| **Machine-parseable tool schemas** | JSON Schema I/O types — runtimes can validate and generate function signatures | Natural language in SKILL.md — the LLM interprets |
| **Multi-runtime portability** | Same YAML runs on WayFlow, LangGraph, AutoGen, CrewAI | Same files read by any Claude session, but Claude-centric |
| **Multi-agent orchestration** | Formal patterns: Swarm, ManagerWorkers, Flow graphs with branching/parallel/map | Each instance is independent — no coordination primitives |
| **Component reuse** | `$component_ref` lets agents share LLM configs, tools, sub-agents | Skills are shared via filesystem, but no formal ref system |
| **Formal validation** | 236KB JSON Schema for editor autocomplete and CI validation | Zod schemas for config, but skill prompts are unstructured |

### Where our format is stronger

| Capability | Our format | Agent Spec |
|------------|-----------|------------|
| **Identity/personality** | `soul.md` — rich freeform prompt per instance | `system_prompt` — single string field, no decomposition |
| **Memory & persistence** | Activity logs, learnings, state checkpoints | Explicitly listed as "future" — nothing today |
| **Scheduling** | Cron schedules with state tracking and auto-disable | Not in spec — no scheduling, triggers, or events |
| **Self-modification** | Agent edits its own files, gated by lint + commit | Not supported — config is static |
| **Invocation modes** | Interactive / cron / channel with different behaviors | No concept — agents are always invoked the same way |
| **Skill expressiveness** | SKILL.md: examples, edge cases, behavioral guidance, references | Tools: typed I/O interface only, no natural language |
| **Authoring ergonomics** | 10-line SKILL.md vs 25+ line tool definition | Flows are extremely verbose: simple 3-step flow = 100+ lines |
| **TypeScript ecosystem** | Native | Python-only SDK, no TS story |

### The fundamental paradigm difference

Agent Spec models agents as **structured workflow executors** — define typed inputs, execute a graph of nodes, produce typed outputs. This is powerful for deterministic pipelines ("extract data from PDF, validate, insert into database").

We model assistants as **conversational sessions with identity** — define a personality, give it skills and context, and let it figure out what to do. This is better for open-ended personal assistant work ("check my email and tell me what's important").

These aren't competing so much as complementary. An agent defined in Agent Spec could *use* our skills. An assistant defined in our format could *invoke* an Agent Spec workflow as a tool. The modeling paradigms serve different use cases.

### What we could learn from

- **Component refs** — the `$component_ref` pattern for sharing tool/config definitions across agents is cleaner than filesystem path references. Worth considering if we ever need cross-instance shared resources.
- **Formal JSON Schema** — having a published JSON Schema for config would enable editor autocomplete and CI validation beyond what Zod gives us at runtime.

## Comparison with Tool-Specific Instruction Files

| File | Tool | Similar to our... |
|------|------|-------------------|
| `CLAUDE.md` | Claude Code | `CLAUDE.md` (entry point) — we use the same file as our entry point |
| `.cursorrules` / `.cursor/rules/*.mdc` | Cursor | — |
| `GEMINI.md` | Gemini CLI | — |
| `AGENTS.md` | Cross-tool (AAIF) | `CLAUDE.md` but for project context, not assistant identity |
| `.github/copilot-instructions.md` | Copilot | — |

These all define *project context for coding agents*. None define an assistant instance with personality, skills, schedules, and multi-mode invocation. That's the gap.

## Summary

Each project/standard optimizes for a different axis:

| Project | Optimizes for |
|---------|--------------|
| **OpenClaw** | Breadth of integration — connect to every platform from a central daemon |
| **Fabric** | Prompt reuse — crowdsourced system prompts you can pipe to any model |
| **SKILL.md / AGENTS.md** | Coding agent context — portable instructions for how to work in a project |
| **Oracle Agent Spec** | Workflow portability — deterministic agent pipelines across runtimes |
| **Our format** | Portable assistant identity — who it is, what it can do, how to invoke it |

The landscape has standardized skills (SKILL.md), project context (AGENTS.md), tool protocols (MCP), and workflow definitions (Agent Spec). What's missing is the *assistant instance* layer that ties them together with personality, memory, and multi-mode invocation. That's what this format provides.
