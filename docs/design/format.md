# Assistant Format Specification

## Overview

The assistant format is a directory convention. An assistant instance is a directory that a Claude session can be pointed at. The `CLAUDE.md` file at the root is the entry point — it bootstraps the session with personality, skills, and behavioral rules.

No daemon, no plugin loader, no framework. Just files on disk.

## Relationship to Existing Standards

The assistant format builds on two emerging standards under the [Agentic AI Foundation (AAIF)](https://aaif.io/):

- **[SKILL.md](https://agentskills.io/specification)** — the cross-tool standard for skill definitions (adopted by Claude Code, Codex, Copilot, Gemini CLI, Goose, Cursor, Windsurf). We use this format for individual skills.
- **[AGENTS.md](https://agents.md/)** — project context for coding agents (60k+ repos). Our `CLAUDE.md` serves a similar role but for assistant identity, not project context.

**The gap we fill:** SKILL.md defines capabilities. AGENTS.md defines project context. Neither defines a portable *assistant instance* — the thing that says "I am an assistant with this personality, these skills, this schedule, and this behavior per invocation mode." That's what this format provides.

## Directory Layout

### Engine Repo (public)

```
~/code/assistant/
├── skills/                          # Skill definitions (SKILL.md format)
│   ├── gmail/
│   │   ├── SKILL.md                 # Standard SKILL.md (YAML frontmatter + prompt)
│   │   └── config.schema.ts         # Zod schema for this skill's config
│   ├── reddit/
│   │   ├── SKILL.md
│   │   └── config.schema.ts
│   ├── browser/
│   │   └── SKILL.md
│   ├── signal/
│   │   └── SKILL.md
│   └── daily-report/
│       └── SKILL.md
├── schemas/
│   ├── assistant.ts                 # AssistantConfigSchema
│   ├── schedule.ts                  # ScheduleSchema + ScheduleStateSchema
│   ├── activity.ts                  # ActivityEntrySchema
│   ├── state.ts                     # StateCheckpointSchema
│   └── invocation.ts               # InvocationContextSchema
├── lib/
│   ├── build-index.ts               # Generates skill index for CLAUDE.md
│   ├── send.ts                      # Unified message send CLI
│   ├── self-lint.ts                 # Typecheck + lint
│   ├── self-commit.ts               # Stage + commit + verify clean
│   └── transports/
│       ├── signal.ts
│       ├── telegram.ts
│       ├── webhook.ts
│       └── push.ts
├── .env.example                     # Documents required secrets
└── package.json
```

### Data Repo (private)

```
~/assistant-data/
├── assistants/
│   ├── my-assistant/                        # One assistant instance
│   │   ├── CLAUDE.md                # Entry point (partially generated)
│   │   ├── soul.md                  # Personality prompt
│   │   ├── config.yaml              # Skills + schedules
│   │   ├── memory/
│   │   │   ├── learnings.md         # Self-recorded insights
│   │   │   ├── activity-log.jsonl   # Structured activity history
│   │   │   └── topics/              # Per-topic memory files
│   │   ├── state/                   # Skill checkpoint files
│   │   │   ├── gmail-last-seen.json
│   │   │   └── reddit-last-run.json
│   │   └── logs/                    # Daily execution logs
│   │       └── 2026-02-20.jsonl
│   └── work-bot/                    # Another assistant instance
│       ├── CLAUDE.md
│       ├── soul.md
│       ├── config.yaml
│       └── ...
├── shared/
│   └── .env                         # Secrets shared across assistants
└── defaults.yaml                    # Shared config defaults (optional)
```

## Skill Format (SKILL.md)

Skills follow the [Agent Skills specification](https://agentskills.io/specification). Each skill is a directory with a `SKILL.md` file:

```markdown
---
name: gmail
description: Check email via IMAP — fetch unread messages, summarize inbox, track read state
---

# Gmail

You can check email using the gmail CLI tool...

## Usage
...
```

The YAML frontmatter provides `name` (kebab-case, max 64 chars) and `description` (max 1024 chars) for indexing. The markdown body contains the full instructions the agent reads when using the skill.

Optional additional files per skill:
- `config.schema.ts` — Zod schema for this skill's config block
- `scripts/` — Helper scripts the skill references
- `references/` — Static reference docs

## Skill Index (generated)

**Problem:** Vercel's evaluation found that SKILL.md progressive disclosure fails — agents never invoked skills in 56% of cases because they didn't know they existed. Inlining full skill docs hits 100% but wastes tokens.

**Solution:** A build step generates a skill index — a compact table extracted from SKILL.md frontmatter — that gets embedded in each assistant's `CLAUDE.md`. The agent always sees *what's available*; it reads the full `SKILL.md` on demand.

### Build step

```bash
tsx ~/code/assistant/lib/build-index.ts \
  --skills ~/code/assistant/skills \
  --config ~/assistant-data/assistants/my-assistant/config.yaml \
  --output ~/assistant-data/assistants/my-assistant/CLAUDE.md
```

The build step:
1. Scans all `SKILL.md` files in the skills directory
2. Extracts `name` and `description` from YAML frontmatter
3. Cross-references with `config.yaml` to mark which skills are configured
4. Validates that every skill referenced in schedules exists
5. Generates/updates the skill index section in `CLAUDE.md`

### Generated index (embedded in CLAUDE.md)

```markdown
<!-- BEGIN SKILL INDEX (auto-generated — do not edit) -->
## Available Skills

| Skill | Description | Configured | Path |
|-------|-------------|:----------:|------|
| browser | Control headless Chromium: navigate, snapshot, interact, screenshot | yes | ~/code/assistant/skills/browser/ |
| daily-report | Aggregate outputs from other skills into a formatted briefing | yes | ~/code/assistant/skills/daily-report/ |
| gmail | Check email via IMAP — fetch unread messages, summarize inbox, track read state | yes | ~/code/assistant/skills/gmail/ |
| reddit | Digest trending posts from configured subreddits via browser | yes | ~/code/assistant/skills/reddit/ |
| signal | Send and receive messages via Signal CLI | yes | ~/code/assistant/skills/signal/ |

**Before using a skill, read its SKILL.md for full instructions.**
<!-- END SKILL INDEX -->
```

### When to rebuild

Run the build step whenever:
- A skill is added or removed from the engine repo
- A skill's frontmatter (name/description) changes
- `config.yaml` skill references change

The build step also serves as a **lint check** — it fails if:
- A skill referenced in `config.yaml` has no `SKILL.md`
- A `SKILL.md` is missing required frontmatter (`name`, `description`)
- A schedule references a skill not present in the skills directory

## File Contracts

### CLAUDE.md (entry point)

The `CLAUDE.md` in each assistant instance directory is the primary entry point. It contains:
- **Hand-written sections:** personality reference, behavior rules, invocation context handling, self-modification rules
- **Generated sections:** skill index table (between `<!-- BEGIN SKILL INDEX -->` / `<!-- END SKILL INDEX -->` markers)

The build step only touches the generated sections. Everything else is preserved.

### soul.md (personality)

Freeform markdown. Injected into context as a system-level prompt. Contains:
- Communication style and tone preferences
- Domain knowledge and expertise areas
- Personal preferences (verbosity, formatting, emoji use)
- Relationship context ("The user is a software engineer who...")

Not validated by any schema — it's a prompt, not config.

### config.yaml (structured config)

Validated against `AssistantConfigSchema`. Contains:
- Assistant name
- Path to soul.md (relative, defaults to `./soul.md`)
- Per-skill configuration blocks
- Schedule definitions
- Default output channel

See [schemas.md](schemas.md) for the full schema reference.

### memory/learnings.md

Freeform markdown the assistant writes to record insights, patterns, and accumulated knowledge. Analogous to `MEMORY.md` in Claude Code projects. The assistant reads this at the start of sessions for continuity.

### memory/activity-log.jsonl

Append-only JSONL. Each line is an `ActivityEntry` (see [schemas.md](schemas.md)). Records what the assistant did, when, and how it went. The assistant can read its own history to avoid repeating work or to reference past results.

### state/<skill>-*.json

Per-skill checkpoint files. Each is a `StateCheckpoint` (see [schemas.md](schemas.md)). Skills use these to track cursors (e.g., last-seen email UID, last Reddit scan timestamp). The `data` payload is skill-specific and validated by the skill's own schema.

### logs/<date>.jsonl

Daily execution logs. Same `ActivityEntry` format as `activity-log.jsonl` but partitioned by date for easier browsing. The activity-log is the canonical source; daily logs are for convenience.

## Invocation

### Interactive

```bash
cd ~/assistant-data/assistants/my-assistant && claude
```

Or via any tool that supports `--cwd` / project directories.

### Scheduled (cron)

```bash
ASSISTANT_TRIGGER=cron:morning-digest \
  claude --dangerously-skip-permissions \
  -p "Run the morning-digest schedule" \
  --cwd ~/assistant-data/assistants/my-assistant
```

The `ASSISTANT_TRIGGER` environment variable tells the assistant how it was invoked. Format: `cron:<schedule-name>`, `interactive`, or `channel:<transport>`.

### Channel (messaging app)

```bash
ASSISTANT_TRIGGER=channel:signal \
ASSISTANT_CHANNEL='{"transport":"signal","sendCommand":"tsx ~/code/assistant/lib/send.ts --transport signal --to +1234567890"}' \
  claude --dangerously-skip-permissions \
  -p "User says: what's trending on r/localllama?" \
  --cwd ~/assistant-data/assistants/my-assistant
```

The assistant receives the user's message as the initial prompt. It uses the send command to reply. It works silently between sends — tool calls, file reads, browser actions are not visible to the user. Only explicit sends appear in the conversation.

### Channel Mode Behavior

When invoked via a messaging channel, the assistant follows these rules:
1. **Acknowledge promptly** — send a short reply so the user knows it's working
2. **Work silently** — tool calls, research, browsing are invisible to the user
3. **Send progress for long tasks** — brief one-liner if work takes >30 seconds
4. **Send a final summary** — concise, conversational, not a raw dump
5. **Limit message volume** — no more than ~3 messages for a simple request
6. **Keep messages short** — under ~500 chars unless detail was requested
7. **Match conversational tone** — this is chat, not a terminal
