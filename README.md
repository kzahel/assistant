# Assistant Engine

Directory convention for portable AI coding-agent assistants. Works with Claude Code, Codex, Gemini CLI, and anything that reads CLAUDE.md or AGENTS.md.

The agent (Claude Code, etc.) is the runtime. This engine just gives it persistent identity, a few tools, and a scheduler.

## Quick Start

```bash
mkdir -p ~/.assistant-data/assistants/dave
cat > ~/.assistant-data/assistants/dave/config.yaml << 'EOF'
name: Dave
EOF
tsx ~/code/assistant/lib/build.ts --instance ~/.assistant-data/assistants/dave
cd ~/.assistant-data/assistants/dave && claude
```

## Layout

**Engine** (this repo) — shared capabilities:

```
skills/          # SKILL.md definitions (browser, gmail, telegram, reddit, git-sync)
lib/             # Tool CLIs + build system
templates/       # CLAUDE.md template
```

**Instance** (private, per-assistant) — identity + state:

```
config.yaml      # name, skill config, schedules (required)
soul.md          # personality
user.md          # who the user is
projects.md      # project context
.env             # secrets
memory/          # learnings, activity logs (runtime)
state/           # skill checkpoints (runtime)
CLAUDE.md        # compiled output (generated)
AGENTS.md        # symlink to CLAUDE.md
```

`build.ts` merges engine skills/template with instance files into a compiled CLAUDE.md. Rebuild after any change.

## Skills

Skills are [SKILL.md](https://agentskills.io/specification) files — markdown instructions, no runtime coupling. Works across Claude Code, Codex, Copilot, Cursor, etc.

| Skill | Description |
|-------|-------------|
| browser | Headless Chromium automation |
| gmail | Email via IMAP/SMTP |
| telegram | Telegram Bot API messaging |
| reddit | Subreddit scraping (uses browser) |
| git-sync | Dirty tree / unpushed commit detection |

## Invocation

```bash
# Interactive (default)
claude

# Scheduled task
ASSISTANT_TRIGGER=cron:morning-digest claude -p "Run morning-digest"

# Messaging channel
ASSISTANT_TRIGGER=channel:telegram claude -p "User says: ..."
```

## Key Decisions

- **No agent loop.** The provider (Claude Code, Codex) handles API calls, tool execution, reasoning. We just provide tools and context.
- **Skills are prompts, not plugins.** No loader, no lifecycle hooks. A SKILL.md works in any agent that reads markdown.
- **Fully self-modifying.** The assistant can edit its own files. Git history is the audit trail.
- **Two repos, clear boundary.** Engine = capabilities (public). Instance = identity (private).

## Docs

See [docs/design/](docs/design/) for format spec, comparisons with other projects, schemas, and architecture decisions.
