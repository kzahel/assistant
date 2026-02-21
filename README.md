# Claw Starter

Minimal self-modifying Claw starter. Telegram, email, browser automation, and a cron scheduler. Works with Claude Code, Codex, Gemini CLI, and anything that reads CLAUDE.md or AGENTS.md.

You bring your own agent runtime (Claude Code, Codex, etc.) — we don't own or wrap it. This is just minimal scaffolding: identity files, a few tool CLIs, and a scheduler that invokes the agent on a cron or incoming message. The assistant edits its own config, memory, and personality as it works.

## Quick Start

```bash
# Clone this repo anywhere
git clone https://github.com/kzahel/claw-starter.git
cd claw-starter && npm install

# Create an instance (private data, lives outside this repo)
mkdir -p ~/.assistant-data/assistants/dave
echo 'name: Dave' > ~/.assistant-data/assistants/dave/config.yaml
npx tsx lib/build.ts --instance ~/.assistant-data/assistants/dave
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

`build.ts` merges engine skills/template with instance files into a compiled CLAUDE.md. The agent knows when to rebuild itself.

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

- **[Getting Started](docs/getting-started.md)** — Set up Telegram + Gmail in 10 minutes
- [docs/design/](docs/design/) — Format spec, comparisons with other projects, schemas, architecture decisions
