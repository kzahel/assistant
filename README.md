# Assistant Engine

A directory convention for portable AI coding-agent assistants. No daemon, no framework — just files on disk. Provider-agnostic: works with Claude Code, Codex, Gemini CLI, or any agent that reads a markdown instructions file.

The engine provides shared capabilities (skills, tools, build system). Each assistant is a named **instance** with its own personality, config, and memory. The build step emits `CLAUDE.md` (the native format for Claude Code) and an `AGENTS.md` symlink so other agents can discover the same file.

## Architecture

```
Engine (this repo)                    Instance (private, per-assistant)
~/code/assistant/                     ~/assistant-data/assistants/<name>/
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
mkdir -p ~/assistant-data/assistants/dave
```

Create `config.yaml`:

```yaml
name: Dave
```

Build and run:

```bash
tsx ~/code/assistant/lib/build.ts --instance ~/assistant-data/assistants/dave
cd ~/assistant-data/assistants/dave && claude
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
tsx ~/code/assistant/lib/build.ts --instance ~/assistant-data/assistants/dave
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

The build step generates a compact index table so the agent always knows what's available without reading every SKILL.md upfront.

Skills are configured per-instance in `config.yaml`. A skill can exist in the engine without being configured — it just shows as "not configured" in the index.

## Invocation Modes

Set `ASSISTANT_TRIGGER` to control behavior:

```bash
# Interactive (default) — conversational, asks questions
cd ~/assistant-data/assistants/dave && claude

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

- [format.md](docs/design/format.md) — full specification
- [engine-instance-boundary.md](docs/design/engine-instance-boundary.md) — why config is minimal
- [schemas.md](docs/design/schemas.md) — Zod schema reference
- [comparison.md](docs/design/comparison.md) — how this differs from alternatives
