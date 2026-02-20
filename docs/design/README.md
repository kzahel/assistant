# Assistant — Design Overview

An open, data-driven format for personal AI assistants. Not a framework, not a daemon — a convention. Any Claude session that enters an assistant directory knows what it is, what it can do, and how to behave.

## Philosophy

**Convention over runtime.** Like how `CLAUDE.md` tells any tool about a project, the assistant format tells any Claude session about a personality, skills, and work habits. The format is the product — runtimes are interchangeable.

**Two repos, clear boundary.**
- **Public engine repo** (`~/code/assistant/`) — skill definitions, schemas, shared tooling. Open source, useful to anyone.
- **Private data repo** (`~/assistant-data/`) — assistant instances (soul, config, memory, secrets). Personal, never published.

**Harness-agnostic.** Works with:
- Claude CLI (`claude --cwd ~/assistant-data/assistants/my-assistant`)
- Yep Anywhere (creates a session with cwd pointing to the instance)
- Any MCP-aware tool, Cursor, VS Code Claude extension, etc.
- System cron / systemd timers for scheduled tasks

**Self-modifying with guardrails.** The assistant can edit its own files (memory, config, even soul) but must lint and commit after changes. The git history is the audit trail.

## Relationship to Existing Standards

Built on the [Agentic AI Foundation (AAIF)](https://aaif.io/) ecosystem:

- **[SKILL.md](https://agentskills.io/specification)** — We use the cross-tool Agent Skills standard for skill definitions. Our skills work in Claude Code, Codex, Copilot, Gemini CLI, Goose, and any tool that adopts the spec.
- **[AGENTS.md](https://agents.md/)** / **CLAUDE.md** — Our entry point is a `CLAUDE.md` that defines assistant identity and behavior, not just project context.

**The gap we fill:** SKILL.md defines skills. AGENTS.md defines project context. Neither defines a portable *assistant instance*. That's what this format provides. See [comparison.md](comparison.md) for the full landscape analysis.

## Core Concepts

### Assistant Instance

A directory containing everything one assistant persona needs:

```
~/assistant-data/assistants/my-assistant/
├── CLAUDE.md              # Entry point (partially generated)
├── soul.md                # Personality, tone, preferences
├── config.yaml            # Skills, schedules, preferences
├── memory/
│   ├── learnings.md       # Self-recorded insights
│   ├── activity-log.jsonl # What the assistant did and when
│   └── topics/            # Per-topic memory files
├── state/                 # Skill-specific checkpoints
└── .env                   # Secrets (gitignored)
```

### Skills

Defined in the engine repo using the [SKILL.md format](https://agentskills.io/specification). Each skill is a directory with a `SKILL.md` (YAML frontmatter + markdown instructions) and optional code. Skills are not plugins — they don't hook into a lifecycle. They're portable instructions that teach any agent how to do something.

### Skill Index (build step)

A build step scans all `SKILL.md` files, extracts `name` and `description` from frontmatter, and generates a compact skill index table that gets embedded in each assistant's `CLAUDE.md`. This solves the discovery problem — agents always see what's available (~50 tokens per skill) and read full `SKILL.md` on demand. The build step also validates that config references match actual skills.

### Invocation Contexts

The assistant behaves differently based on how it was started:

| Context | Behavior |
|---------|----------|
| `interactive` | Conversational, asks questions, full output |
| `cron` | Autonomous, runs scheduled skills, logs results |
| `channel` | Messaging app — acknowledge, work silently, send summary |

### Memory

Append-only activity logs (JSONL) + freeform learnings (markdown). The assistant reads its own history to build context. No vector DB required for MVP — just files Claude can read.

## Documents

- [format.md](format.md) — The assistant format specification (directory layout, file contracts)
- [schemas.md](schemas.md) — Zod schema reference for config, schedules, activity logs
- [comparison.md](comparison.md) — How this differs from OpenClaw, Fabric, Oracle Agent Spec, and other projects
- [openclaw-analysis.md](openclaw-analysis.md) — Deep dive into OpenClaw's gateway, session model, channel delivery, and message concurrency
- [mvp.md](mvp.md) — MVP scope, skills, and roadmap
