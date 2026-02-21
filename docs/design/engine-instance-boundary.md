# Engine vs Instance Boundary

## Status

| Item | Status |
|------|--------|
| Drop `skillsDir` from config | Done |
| Drop `toolPaths` from config | Done |
| Auto-discover tools in build.ts | Done — scans `lib/*-cli.ts` |
| Browser-control integration | Done — server at `lib/browser/`, CLI at `lib/browser-cli.ts` |

## Problem (resolved)

The original design leaked engine concerns into instance config:

- `skillsDir` in config.yaml pointed back to the engine repo
- `toolPaths` in config.yaml mapped tool names to engine CLI scripts
- Every instance on the same machine duplicated these identical values

Instance config should only contain things that differ per-assistant: personality, skill preferences, schedules, secrets. It shouldn't know where the engine is installed.

## Design

### What lives where

**Engine repo** (public, `<engine-repo>/`):
- Skill definitions (`skills/*/SKILL.md`)
- Tool implementations (`lib/*-cli.ts`)
- Build script, scheduler, templates
- Tool discovery (convention-based)

**Instance data** (private, `~/assistant-data/assistants/<name>/`):
- `soul.md` — personality
- `config.yaml` — skill config (which subreddits, which email account), schedules, output preferences
- `memory/` — learnings, activity logs
- `state/` — skill checkpoints
- `.env` — secrets

### Drop `toolPaths` from config.yaml

The build step already knows the engine directory (`--engine-dir` or auto-detected via `import.meta.dirname`). It can auto-discover tools by convention:

```
lib/gmail-cli.ts    → tool name: "gmail"
lib/browser-cli.ts  → tool name: "browser"
```

Convention: `lib/<name>-cli.ts` → tool `<name>`, invoked as `tsx <engine>/lib/<name>-cli.ts`.

The build step scans `lib/*-cli.ts`, generates the tool paths table, and bakes it into the CLAUDE.md. No per-instance config needed.

### Drop `skillsDir` from config.yaml

Same logic — the build step knows where skills are. The `--instance` flag tells it where the instance is, and the engine dir is either passed explicitly or inferred. Skills dir is always `<engine>/skills/`.

### Simplified config.yaml

Before:
```yaml
name: my-assistant
skillsDir: <engine-repo>/skills
toolPaths:
  gmail: tsx <engine-repo>/lib/gmail-cli.ts
  browser: tsx <engine-repo>/lib/browser-cli.ts

skills:
  gmail:
    account: user@example.com
    folders: [INBOX]
    maxAge: 24h
  reddit:
    subreddits: [localllama, machinelearning]
    topN: 10

schedules:
  - name: morning-digest
    cron: "0 7 * * *"
    skills:
      - skill: gmail
      - skill: reddit
    output: push
```

After:
```yaml
name: my-assistant

skills:
  gmail:
    account: user@example.com
    folders: [INBOX]
    maxAge: 24h
  reddit:
    subreddits: [localllama, machinelearning]
    topN: 10

schedules:
  - name: morning-digest
    cron: "0 7 * * *"
    skills:
      - skill: gmail
      - skill: reddit
    output: push
```

### Build step changes

`build.ts` accepts `--engine-dir` and auto-detects it. All changes implemented:

1. ~~Add `buildToolPaths()` auto-discovery: scan `lib/*-cli.ts`, extract tool names from filenames~~ Done
2. ~~Remove `toolPaths` from config type~~ Done
3. ~~Remove `skillsDir` from config type~~ Done (was already removed)
4. ~~Update template to include auto-generated tool paths section~~ Done

### What this enables

- Instance configs are fully portable between machines (no hardcoded paths)
- Adding a new CLI tool to the engine automatically makes it available to all instances on next build
- Cleaner mental model: engine = capabilities, instance = preferences + data
