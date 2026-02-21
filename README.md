# Assistant Engine (Convention + Example)

A directory convention for portable AI coding-agent assistants. No daemon, no framework — just files on disk. Provider-agnostic: works with Claude Code, Codex, Gemini CLI, or any agent that reads a markdown instructions file.

The engine provides shared capabilities (skills, tools, build system). Each assistant is a named **instance** with its own personality, config, and memory. The build step emits `CLAUDE.md` (the native format for Claude Code) and an `AGENTS.md` symlink so other agents can discover the same file.

## Philosophy

**Minimum required to be useful, not a framework.** Read and send email. Browse the web. Message you on Telegram. Run tasks on a schedule. Fully self-modifying — the agent understands its own format and evolves organically. That's the baseline. You choose the security posture, the tasks, and who can talk to it.

**Convention over runtime.** Like how `CLAUDE.md` tells any tool about a project, the assistant format tells any agent session about a personality, skills, and work habits. The format is the product — runtimes are interchangeable.

**Skills are prompts, not plugins.** Skills follow the [SKILL.md](https://agentskills.io/specification) standard — markdown instructions any agent can read. No loader, no lifecycle hooks, no runtime coupling. A skill written for this format works in Claude Code, Codex, Copilot, Gemini CLI, Goose, or Cursor without modification.

**Two repos, clear boundary.** The public engine repo has capabilities (skill definitions, tool CLIs, build script). The private data repo has identity (personality, user context, secrets, memory). Instance configs contain only things that differ per-assistant — they never reference the engine.

**Fully self-modifying.** The assistant can edit any of its own files — memory, config, personality, even add new skills. This isn't a formal system; it happens organically as the assistant works. Git history is the audit trail. You decide what guardrails to set.

## Why This Exists

The AI agent ecosystem has converged on standards for individual pieces — [SKILL.md](https://agentskills.io/specification) for skills, [AGENTS.md](https://agents.md/) for project context, [MCP](https://modelcontextprotocol.io/) for tool protocols — all under the [Agentic AI Foundation (AAIF)](https://aaif.io/). Meanwhile, the "Claw" category (OpenClaw, ZeroClaw, NanoClaw, etc.) has dozens of runtime daemons that wrap LLM APIs into local assistants with messaging, scheduling, and memory.

**The gap:** no standard defines a portable *assistant instance* — the thing that says "I am an assistant with this personality, these skills, this schedule, and this behavior per invocation mode."

- SKILL.md defines skills but not the assistant that uses them
- AGENTS.md defines project context but not persona/identity/scheduling
- Claws have the operational layer but lock it to their runtime — skills, identity, and memory written for one don't transfer to another

**Claws are runtimes. We're a format.** A Claw wraps the LLM — it manages API calls, tool execution, session state, and channel routing. We don't wrap the LLM. We configure existing agents (Claude Code, Codex) and give them persistent identity, skills, scheduling, and multi-channel access. The agent is Claude Code; we're the assistant layer on top.

| Aspect | Claws (OpenClaw et al.) | This format |
|--------|------------------------|-------------|
| **Core abstraction** | Gateway/daemon wrapping LLM APIs | Directory convention + scheduler invoking existing agents |
| **Skill model** | Runtime plugins (TypeScript/Python modules) | SKILL.md files (markdown instructions the agent reads) |
| **Portability** | Locked to that Claw's runtime | Any agent that reads CLAUDE.md / AGENTS.md |
| **Security model** | Application-level permissions within the daemon | Inherits from the underlying agent |

See [docs/design/comparison.md](docs/design/comparison.md) for detailed comparisons with OpenClaw, Fabric, Oracle Agent Spec, PAI, ElizaOS, and others.

## Architecture

```
Engine (this repo)                    Instance (private, per-assistant)
~/code/assistant/                     ~/.assistant-data/assistants/<name>/
├── skills/                           ├── config.yaml        ← required
│   ├── browser/SKILL.md              ├── soul.md            ← personality
│   ├── gmail/SKILL.md                ├── user.md            ← user context
│   ├── git-sync/SKILL.md             ├── projects.md        ← project refs
│   └── reddit/SKILL.md               ├── heart.md           ← pronouns, prefs
├── lib/                              ├── .env               ← secrets
│   ├── build.ts                      ├── memory/            ← learnings, logs
│   ├── browser-cli.ts                ├── state/             ← skill checkpoints
│   ├── gmail-cli.ts                  ├── sessions/          ← conversation history
│   ├── git-sync-cli.ts               ├── CLAUDE.md          ← compiled (generated)
│   ├── scheduler.ts                  └── AGENTS.md          ← symlink → CLAUDE.md
│   └── browser/                      The instance never references the engine
│       ├── server.ts                 directly. build.ts bridges the two.
│       ├── routes.ts
│       └── playwright.ts
├── templates/
│   └── claude.md
└── docs/design/
```

**Engine** = capabilities (skills, tool CLIs, build script, template). Public, shared.

**Instance** = identity (personality, user info, secrets, memory). Private, per-assistant.

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
