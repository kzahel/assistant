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

## The "Claw" Category

As of Feb 2026, "Claw" has become a recognized term of art for the entire category of OpenClaw-like agent systems. Andrej Karpathy described Claws as "a new layer on top of LLM agents, taking the orchestration, scheduling, context, tool calls and a kind of persistence to a next level." Simon Willison validated this, noting the category has its own emoji (🦞) and a proliferating ecosystem of variants.

**Defining characteristics of a Claw:**
- Runs on personal hardware (local-first)
- Communicates via messaging protocols (WhatsApp, Telegram, Discord, Signal)
- Acts on direct instructions AND schedules autonomous tasks
- Gateway/daemon architecture — always-running process that wraps LLM agents

### The Claw Ecosystem (Feb 2026)

| Project | Stars | Language | RAM | Key Differentiator |
|---------|-------|----------|-----|-------------------|
| **OpenClaw** | 215k | TypeScript | >1GB | The original. Full-featured, 5,700+ skills on ClawHub |
| **Nanobot** | 22.4k | Python | Low | ~4K lines. Research-friendly. MCP integration |
| **PicoClaw** | 17.2k | Go | <10MB | Runs on $10 RISC-V boards. Embedded-first |
| **ZeroClaw** | 16k | Rust | <5MB | Single binary, 22+ providers, trait-based architecture |
| **NanoClaw** | 10.2k | TypeScript | Moderate | Container isolation (Docker/Apple Container). Security-first |
| **Moltworker** | 8.6k | TypeScript | N/A | Serverless on Cloudflare Workers |
| **IronClaw** | 2.6k | Rust | Moderate | WASM sandboxing, PostgreSQL, defense-in-depth |
| **TrustClaw** | — | TypeScript | N/A | Cloud sandbox, OAuth-only, managed integrations (Composio) |

**Trends across the ecosystem:**
- **Smaller/lighter:** Every variant pitches itself as leaner than OpenClaw's 430K+ lines and 1.5GB+ RAM
- **Better security:** Container isolation (NanoClaw), WASM sandboxing (IronClaw), cloud sandboxes (TrustClaw) — the "giving an AI shell access" problem is top of mind
- **Rust rewrites:** ZeroClaw and IronClaw bet on Rust for safety + single-binary deployment
- **Embedded targets:** PicoClaw runs on $10 RISC-V boards — the "agent on every device" future

### How we're NOT a Claw

**Claws are runtimes. We're a format + distribution layer.**

A Claw wraps the LLM — it manages the API calls, tool execution, session state, and channel routing. The agent IS the Claw.

We don't wrap the LLM. We configure existing agents (Claude Code, Codex) and give them persistent identity, skills, scheduling, and multi-channel access. The agent is Claude Code; we're the assistant layer on top.

| Aspect | Claws (OpenClaw et al.) | Our approach |
|--------|------------------------|-------------|
| **Core abstraction** | Gateway/daemon wrapping LLM APIs | Directory convention + scheduler invoking existing agents |
| **Agent execution** | Built-in (manages API calls, tool loops) | Delegated (spawns Claude Code / Codex sessions) |
| **Skill model** | Runtime plugins (TypeScript/Python modules) | SKILL.md files (markdown instructions the agent reads) |
| **Portability** | Locked to that Claw's runtime | Any agent that reads CLAUDE.md |
| **Security model** | Application-level permissions within the daemon | Inherits from the underlying agent (Claude Code's permission system) |
| **Update model** | Update the Claw binary/package | Update the engine, rebuild CLAUDE.md — agent gets new capabilities |

**The strategic implication:** Claws are competing with each other on runtime features — smaller binary, better sandboxing, more providers, more channels. That's a crowded race. We're competing on a different axis: making any agent into a persistent personal assistant. A Claw user can't easily switch from OpenClaw to ZeroClaw without rebuilding their setup. Our format is portable across agents — same soul.md, same skills, same memory works whether invoked by Claude Code, Codex, or a future agent.

## Comparison with OpenClaw

[OpenClaw](https://github.com/openclaw/openclaw) (~215K GitHub stars, up from ~140K in Jan 2026) is the most popular open-source personal AI assistant — a local daemon that uses messaging platforms as its UI. See **[openclaw-analysis.md](openclaw-analysis.md)** for a detailed deep dive into its gateway architecture, session model, channel delivery, message concurrency, and plugin system.

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

## Comparison with PAI (Personal AI Infrastructure)

[PAI](https://github.com/danielmiessler/Personal_AI_Infrastructure) by Daniel Miessler (also the creator of Fabric) is the closest conceptual match to this project. It defines a personal AI "operating system" as a set of markdown files — identity across 10 layers (MISSION.md, GOALS.md, PROJECTS.md, BELIEFS.md, etc.). Claude Code native.

| Aspect | PAI | Assistant Format |
|--------|-----|-----------------|
| **Core idea** | Portable identity in markdown files | Portable identity + operational capabilities |
| **Identity** | 10 decomposed files (MISSION, GOALS, BELIEFS, etc.) | `soul.md` (freeform) + `user.md` + `heart.md` |
| **Skills** | Six layers including Skills and Hooks | SKILL.md standard with per-skill config |
| **Memory** | Memory layer | Activity logs + learnings + state checkpoints |
| **Scheduling** | None | Cron schedules with state tracking and auto-disable |
| **Channels** | None — interactive only | Multi-mode: interactive / cron / channel |
| **Build step** | None — raw files | Compiled CLAUDE.md from source files |
| **Operational skills** | Information processing patterns | Browser automation, email, messaging, git sync |

PAI is more "define who you are" — a personal knowledge management system that shapes how an AI understands you. We're more "define who you are AND what you do" — an operational assistant that checks email, scrapes Reddit, sends Telegram messages, and runs on a schedule. PAI could be a great identity layer *inside* our format, but it doesn't have the execution story.

## Comparison with ElizaOS

[ElizaOS](https://github.com/elizaOS/eliza) is a TypeScript framework for autonomous agents with a character/personality system, memory with RAG, and 90+ plugins. Large community, primarily Web3/crypto oriented.

| Aspect | ElizaOS | Assistant Format |
|--------|---------|-----------------|
| **Identity** | Character JSON files with personality traits, example dialogues | `soul.md` — freeform prompt |
| **Memory** | RAG-based with vector storage | File-based: activity logs, learnings, state |
| **Plugins** | 90+ runtime plugins (Discord, Telegram, Twitter, crypto) | SKILL.md files — no loader, no runtime |
| **Architecture** | Long-running Node.js process with plugin lifecycle | No daemon — invoked per-session |
| **Portability** | Locked to ElizaOS runtime | Any Claude session, any harness |
| **Focus** | Multi-agent environments, crypto/Web3, social media | Personal productivity, developer workflows |

ElizaOS's character JSON is conceptually similar to our compiled CLAUDE.md — both are "personality as config." But ElizaOS is a full runtime with plugin lifecycle management, while we're just files that any agent can read. Different weight classes.

## Comparison with Moltworker

[Moltworker](https://github.com/cloudflare/moltworker) is Cloudflare's open-source proof-of-concept for a self-hosted personal AI agent. Runs on Cloudflare Workers with R2 for persistent memory and browser automation via Browser Rendering API.

| Aspect | Moltworker | Assistant Format |
|--------|-----------|-----------------|
| **Runtime** | Cloudflare Workers (edge) | No runtime — files on disk |
| **Memory** | R2 object storage | Local filesystem |
| **Browser** | Cloudflare Browser Rendering API | Playwright via browser skill |
| **Messaging** | Built-in channel integrations | Channel mode via send CLI |
| **Portability** | Locked to Cloudflare infrastructure | Any machine, any harness |
| **Cost model** | Cloudflare Workers pricing | Local compute, no cloud dependency |

Similar end-goal (personal assistant with messaging and memory) but completely different architecture. Moltworker is cloud-native and vendor-locked; we're local-first and portable. Interesting as validation that the "personal AI agent" category has legs — Cloudflare built one internally and open-sourced it.

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
| **Claws (OpenClaw, ZeroClaw, etc.)** | Runtime — wrap LLM APIs into a local daemon with channels, tools, scheduling |
| **PAI** | Personal identity — define who you are across 10 markdown layers |
| **Fabric** | Prompt reuse — crowdsourced system prompts you can pipe to any model |
| **ElizaOS** | Autonomous social agents — character-driven bots for Web3/social media |
| **SKILL.md / AGENTS.md** | Coding agent context — portable instructions for how to work in a project |
| **Oracle Agent Spec** | Workflow portability — deterministic agent pipelines across runtimes |
| **Our format** | Portable assistant identity — who it is, what it can do, how to invoke it |

The landscape has standardized skills (SKILL.md), project context (AGENTS.md), tool protocols (MCP), and workflow definitions (Agent Spec). The "Claw" category (Feb 2026) has converged around the runtime layer — gateway daemons that wrap LLMs. What's still missing is the *assistant instance* layer that ties skills, identity, memory, and multi-mode invocation together in a portable, agent-agnostic format.

**The Claw explosion validates the category but also the gap.** Every Claw reimplements identity, memory, scheduling, and channel routing from scratch. NanoClaw's identity is different from OpenClaw's is different from ZeroClaw's. Skills written for one don't work in another. There's no portable "assistant instance" — just runtime-locked configurations. Our format could be the interop layer: define your assistant once, run it on any Claw (or any agent).

PAI comes closest to our thesis but lacks the operational layer — no scheduling, no channels, no build step. The Claws have the operational layer but lock it to their runtime. Our format is the only thing that's portable, operational, and runtime-agnostic.
