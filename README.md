# Assistant Engine (Convention + Example)

A directory convention for portable AI coding-agent assistants. No daemon, no framework — just files on disk. Provider-agnostic: works with Claude Code, Codex, Gemini CLI, or any agent that reads a markdown instructions file.

The engine provides shared capabilities (skills, tools, build system). Each assistant is a named **instance** with its own personality, config, and memory. The build step emits `CLAUDE.md` (the native format for Claude Code) and an `AGENTS.md` symlink so other agents can discover the same file.

## Philosophy

**Minimum required to be useful, not a framework.** Read and send email. Browse the web. Message you on Telegram. Run tasks on a schedule. Fully self-modifying — the agent understands its own format and evolves organically. That's the baseline. You choose the security posture, the tasks, and who can talk to it.

**The agent is the runtime.** Claude Code (or Codex, or whatever) does the actual work — API calls, tool execution, reasoning. This engine just gives it persistent identity, a few useful tools, and a way to be invoked on a schedule or from a message. There's real code in `lib/` (browser server, IMAP client, etc.), but it's thin wrappers the agent calls as CLIs. The agent loop itself is someone else's problem. This also means your provider subscription, billing, usage dashboard, telemetry, and permission system all still work — we're not bypassing anything. And because we re-use the provider's live session between messages, conversation context is maintained without re-sending the full history on every turn.

**Skills are prompts, not plugins.** Skills follow the [SKILL.md](https://agentskills.io/specification) standard — markdown instructions any agent can read. No loader, no lifecycle hooks, no runtime coupling. A skill written for this format works in Claude Code, Codex, Copilot, Gemini CLI, Goose, or Cursor without modification.

**Two repos, clear boundary.** The public engine repo has capabilities (skill definitions, tool CLIs, build script). The private data repo has identity (personality, user context, secrets, memory). Instance configs contain only things that differ per-assistant — they never reference the engine.

**Fully self-modifying.** The assistant can edit any of its own files — memory, config, personality, even add new skills. This isn't a formal system; it happens organically as the assistant works. Git history is the audit trail. You decide what guardrails to set.

## How This Relates to Other Projects

There's a growing ecosystem of personal AI assistants — OpenClaw, NanoClaw, ZeroClaw, and others (collectively called "Claws"). They're gateway daemons that wrap LLM APIs and manage the full agent loop: API calls, tool execution, session state, channel routing, plugin systems.

This project is smaller and more opinionated. It doesn't manage the agent loop — it lets Claude Code (or Codex, etc.) be the agent and just gives it tools, identity, and scheduling. The `lib/` directory has real runtime code (browser server, IMAP client, Telegram bot), but it's all thin CLIs the agent invokes. There's no plugin system, no gateway, no session management.

The tradeoff: Claws are more full-featured out of the box. This is more transparent — it's just files and scripts, easy to understand and modify. Whether that's better depends on what you want.

This project also builds on emerging standards where possible: [SKILL.md](https://agentskills.io/specification) for skill definitions, [AGENTS.md](https://agents.md/) for agent discovery. Skills are markdown files, not runtime plugins, so they work across tools.

See [docs/design/comparison.md](docs/design/comparison.md) for detailed comparisons with OpenClaw, Fabric, Oracle Agent Spec, PAI, ElizaOS, and others.

## Architecture

**Engine** (this repo) = capabilities. Public, shared.

```
~/code/assistant/
├── skills/              # SKILL.md definitions
│   ├── browser/
│   ├── gmail/
│   ├── reddit/
│   ├── telegram/
│   └── git-sync/
├── lib/                 # Tool CLIs + build system
│   ├── build.ts
│   ├── scheduler.ts
│   ├── browser-cli.ts
│   ├── gmail-cli.ts
│   └── telegram-cli.ts
├── templates/
│   └── claude.md        # CLAUDE.md template
└── docs/design/
```

**Instance** (private, per-assistant) = identity + state. Never references the engine.

```
~/.assistant-data/assistants/<name>/
├── config.yaml          # required — name, skill config, schedules
├── soul.md              # personality / tone
├── user.md              # who the user is
├── projects.md          # project context
├── heart.md             # pronouns, accessibility
├── .env                 # secrets
├── memory/              # learnings, activity logs
├── state/               # skill checkpoints
├── sessions/            # conversation history
├── CLAUDE.md            # compiled by build.ts (generated)
└── AGENTS.md            # symlink → CLAUDE.md
```

`build.ts` bridges the two — it reads the engine's skills and template, merges with instance files, and writes the compiled `CLAUDE.md`.

## Creating a New Assistant

Minimum: 1 file.

```bash
mkdir -p ~/.assistant-data/assistants/dave
```

Create `config.yaml`:

```yaml
name: Dave
```

Build and run:

```bash
tsx ~/code/assistant/lib/build.ts --instance ~/.assistant-data/assistants/dave
cd ~/.assistant-data/assistants/dave && claude
```

That gives you a working assistant with all skills available (but none configured) and auto-discovered tools. Non-Claude agents can point at `AGENTS.md` (a symlink to `CLAUDE.md`) in the instance directory.

### Adding personality and skills

```yaml
# config.yaml
name: Dave

skills:
  browser:
    dataDir: ~/.browser-control/user-data
  gmail:
    account: dave@example.com
    sendTo: dave@example.com
    folders: [INBOX]
    maxAge: 24h
  reddit:
    subreddits: [programming, rust]
    topN: 10
  git-sync:
    codeDirs:
      - ~/code
```

Create `soul.md`:

```markdown
You are Dave, a no-nonsense engineering assistant.
Keep answers short. Prefer code over prose.
```

Optionally add `user.md`, `projects.md`, `heart.md`, `.env` as needed. Rebuild after any change:

```bash
tsx ~/code/assistant/lib/build.ts --instance ~/.assistant-data/assistants/dave
```

### Instance files

| File | Purpose | Required |
|------|---------|----------|
| `config.yaml` | Name, skill config, schedules | Yes |
| `soul.md` | Personality / tone | No |
| `user.md` | Who the user is | No |
| `projects.md` | Project context | No |
| `heart.md` | Pronouns, accessibility | No |
| `.env` | Secrets (e.g. `GMAIL_APP_PASSWORD`) | Only if needed by skills |

Everything else (`memory/`, `state/`, `sessions/`) is created by the assistant at runtime.

## How the Build Works

`build.ts` compiles a `CLAUDE.md` for an instance by merging the template with instance files:

```bash
tsx lib/build.ts --instance <path>
```

1. Reads `config.yaml`, `soul.md`, `user.md`, `heart.md`, `projects.md`, `memory/learnings.md` from the instance
2. Scans `skills/*/SKILL.md` — extracts frontmatter, builds a skill index table
3. Auto-discovers tools by convention: `lib/*-cli.ts` → tool `<name>` (e.g. `browser-cli.ts` → tool `browser`)
4. Renders `templates/claude.md` with all the above
5. Writes `CLAUDE.md` into the instance directory

The instance never hardcodes paths to the engine. Adding a new `lib/foo-cli.ts` to the engine makes it available to all instances on next build.

## Tools

Tools are CLI scripts in `lib/` that follow the naming convention `<name>-cli.ts`. They're auto-discovered by the build step and listed in the compiled CLAUDE.md.

| Tool | CLI | Description |
|------|-----|-------------|
| browser | `lib/browser-cli.ts` | HTTP client for the headless browser server |
| gmail | `lib/gmail-cli.ts` | IMAP/SMTP client for email |
| git-sync | `lib/git-sync-cli.ts` | Wrapper around `skills/git-sync/scripts/check-repos.sh` |

### Browser server

The browser tool requires a running server:

```bash
npm run browser:server     # starts on port 51979
npx playwright install chromium  # first-time setup
```

## Skills

Skills follow the [SKILL.md specification](https://agentskills.io/specification). Each is a directory under `skills/` with a `SKILL.md` containing YAML frontmatter (`name`, `description`) and markdown instructions.

The engine ships a deliberately small set of core skills:

| Skill | What it does |
|-------|-------------|
| **browser** | Headless Chromium automation — navigate, interact, extract content |
| **gmail** | Read and send email via IMAP/SMTP |
| **telegram** | Send/receive messages via Telegram Bot API (chosen for easy setup and official bot support) |
| **reddit** | Scrape and summarize subreddits — a sample skill that composes the browser skill |
| **git-sync** | Scan local repos for dirty trees and unpushed commits |

The build step generates a compact index table so the agent always knows what's available without reading every SKILL.md upfront. Skills are configured per-instance in `config.yaml`. A skill can exist in the engine without being configured — it just shows as "not configured" in the index.

## Invocation Modes

Set `ASSISTANT_TRIGGER` to control behavior:

```bash
# Interactive (default) — conversational, asks questions
cd ~/.assistant-data/assistants/dave && claude

# Scheduled task — autonomous, runs skills, delivers output
ASSISTANT_TRIGGER=cron:morning-digest claude -p "Run morning-digest" --cwd <instance>

# Messaging channel — acknowledges, works silently, sends summary
ASSISTANT_TRIGGER=channel:telegram claude -p "User says: ..." --cwd <instance>
```

## Schedules

Defined per-instance in `config.yaml`:

```yaml
schedules:
  - name: morning-digest
    cron: "0 7 * * *"
    skills:
      - skill: gmail
      - skill: reddit
    output: gmail
```

## Design Docs

Deeper dives in `docs/design/`:

- [**comparison.md**](docs/design/comparison.md) — Landscape analysis: how this differs from Claws (OpenClaw, ZeroClaw, NanoClaw), Fabric, Oracle Agent Spec, PAI, ElizaOS, Moltworker, and the AAIF standards
- [**openclaw-analysis.md**](docs/design/openclaw-analysis.md) — Deep dive into OpenClaw's gateway architecture, session model, channel delivery, and message concurrency — and what we borrow vs avoid
- [**format.md**](docs/design/format.md) — Full format specification: directory layout, file contracts, invocation modes
- [**engine-instance-boundary.md**](docs/design/engine-instance-boundary.md) — Why instance config is minimal and never references the engine
- [**schemas.md**](docs/design/schemas.md) — Zod schema reference for config, schedules, activity logs, state checkpoints
- [**mvp.md**](docs/design/mvp.md) — MVP scope, skill definitions, infrastructure, and milestones
