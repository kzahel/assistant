# MVP Scope

The MVP proves the format works end-to-end: an assistant with a personality, a few useful skills, scheduled tasks, channel output, and basic memory. Everything beyond this is iteration.

## MVP Skills

All skills use the [SKILL.md format](https://agentskills.io/specification) — YAML frontmatter with `name` and `description`, markdown body with full instructions.

### 1. Browser (via headless Chrome)

Reuse the browser-control system from Yep Anywhere. The skill prompt teaches Claude the snapshot-act-verify workflow.

**Capabilities:**
- Open URLs, navigate, take snapshots (accessibility tree)
- Click, type, fill forms, extract content
- Stealth mode for sites that block headless browsers
- Foundation skill — other skills (Reddit, web research) build on this

**Config:** Browser server URL, optional custom Chrome data dir.

**Dependencies:** browser-control server running (from yepanywhere or standalone).

### 2. Gmail (via IMAP)

Read email via IMAP. No sending in MVP — read-only digest.

**Capabilities:**
- Connect to Gmail via IMAP (app password)
- Fetch unread/recent messages from configured folders
- Summarize inbox: sender, subject, snippet, flags
- Track last-seen UID to avoid re-processing

**Config:** Account, folders, maxAge, credential reference.

**State checkpoint:** `gmail-last-seen.json` with `uidNext` and `lastMessageId`.

**Implementation options:**
- Claude uses a Node.js IMAP library via a small CLI wrapper
- Or Claude calls a skill script that does the IMAP work and returns structured output

**Secrets:** IMAP app password in `.env` (`GMAIL_APP_PASSWORD`).

### 3. Reddit Digest (via browser)

Use the browser skill to browse Reddit and summarize trending content.

**Capabilities:**
- Open configured subreddits in browser
- Snapshot the page, extract top N posts
- Summarize each post (title, score, comment count, key discussion points)
- Optionally drill into top comments for high-engagement posts

**Config:** Subreddits list, topN per subreddit, whether to read comments.

**State checkpoint:** `reddit-last-run.json` with last scan timestamp and post cursors.

**Why browser instead of Reddit API:** Reddit's API has aggressive rate limits and requires OAuth app registration. Browser scraping with stealth mode works reliably and matches how a human would browse.

### 4. Signal Messaging

Send and receive messages via Signal. MVP focuses on sending (for output delivery). Receiving (for channel mode input) is a stretch goal.

**Capabilities (MVP):**
- Send text messages to a configured recipient
- Used as an output transport for scheduled tasks and channel mode replies

**Capabilities (stretch):**
- Listen for incoming messages (requires a small daemon)
- Route incoming messages to channel-mode Claude sessions

**Config:** Recipient phone number, Signal CLI path.

**Dependencies:** [signal-cli](https://github.com/AsamK/signal-cli) installed and registered.

**Secrets:** Signal account linked via signal-cli registration (stored in signal-cli's data dir, not in assistant config).

### 5. Daily Report

Meta-skill that aggregates output from other skills into a formatted summary.

**Capabilities:**
- Run configured skills in sequence
- Collect their outputs
- Format a cohesive daily briefing (not just concatenated skill outputs)
- Deliver via configured output channel

**Config:** Which sub-skills to include, output format preferences.

This skill is mostly a prompt — it tells Claude to run other skills and synthesize the results.

## MVP Infrastructure

### Schemas (Zod)

Implement the schemas from [schemas.md](schemas.md):
- `SkillFrontmatterSchema` — validates SKILL.md YAML frontmatter
- `SkillIndexSchema` — generated skill discovery table
- `AssistantConfigSchema` — validates `config.yaml`
- `ScheduleSchema` + `ScheduleStateSchema` — schedule definitions with runtime state
- `ActivityEntrySchema` — activity log entries
- `StateCheckpointSchema` — per-skill state
- `InvocationContextSchema` — how the session was triggered

### Build / Index Step

The `build-index` command scans all SKILL.md files, extracts frontmatter, cross-references with `config.yaml`, and generates/updates the skill index section in `CLAUDE.md`.

```bash
tsx <engine-repo>/lib/build-index.ts \
  --skills <engine-repo>/skills \
  --config ~/assistant-data/assistants/my-assistant/config.yaml \
  --output ~/assistant-data/assistants/my-assistant/CLAUDE.md
```

Also serves as a lint check:
- Fails if a skill referenced in `config.yaml` has no `SKILL.md`
- Fails if `SKILL.md` is missing required frontmatter
- Fails if a schedule references an unconfigured skill

### Send CLI

Unified message sender: `tsx lib/send.ts --transport <signal|push|webhook> "message"`.

MVP transports:
- **Signal** — wraps signal-cli
- **Log** — append to a file (default, always works)
- **Webhook** — HTTP POST to a URL (enables integration with anything)

Push notification transport (via Yep Anywhere) is a fast follow.

### Self-lint / Self-commit

Small utilities the assistant calls after modifying its own files:
- `self-lint.ts` — run typecheck + biome on the engine repo
- `self-commit.ts` — stage changes, commit, verify clean working tree

### Schedule Runner

Minimal script that reads `config.yaml`, finds the named schedule, and spawns a Claude session.

```bash
# Invoked by system cron:
tsx <engine-repo>/lib/run-schedule.ts \
  --assistant ~/assistant-data/assistants/my-assistant \
  --schedule morning-digest
```

The runner:
1. Reads and validates `config.yaml`
2. Checks `_state` (skip if auto-disabled from errors)
3. Sets `ASSISTANT_TRIGGER=cron:<name>` environment variable
4. Spawns a Claude session with `--cwd` pointing to the instance dir
5. After completion, updates `_state` in `config.yaml`
6. Appends to `memory/activity-log.jsonl`

## Example Instance

```
~/assistant-data/assistants/my-assistant/
├── CLAUDE.md
├── soul.md
├── config.yaml
├── memory/
│   ├── learnings.md
│   └── activity-log.jsonl
└── state/
```

**soul.md:**
```markdown
You are a personal assistant for a software engineer.

Communication style:
- Be terse and direct. No filler, no fluff.
- Assume technical competence — don't explain basics.
- Use plain text, not markdown, when responding via messaging channels.
- When summarizing content, lead with what's interesting or actionable.
- If something requires the user's attention, say so explicitly.
```

**config.yaml:**
```yaml
name: my-assistant
defaultOutput: push
skillsDir: <engine-repo>/skills

skills:
  gmail:
    account: user@example.com
    folders: [INBOX]
    maxAge: 24h
  reddit:
    subreddits: [localllama, machinelearning]
    topN: 10
  signal:
    recipient: "+1234567890"
  browser:
    dataDir: ~/.browser-control

schedules:
  - name: morning-digest
    cron: "0 7 * * *"
    skills:
      - skill: gmail
      - skill: reddit
    output: push

  - name: pm-report
    cron: "0 17 * * 1-5"
    skills:
      - skill: daily-report
        args:
          include: [gmail, reddit]
    output: signal
```

## Non-Goals for MVP

- **Vector/semantic memory search** — plain file reads and grep are sufficient initially. Add embeddings later when memory gets large.
- **Telegram/Discord/WhatsApp** — Signal is the MVP messaging transport. Others are just additional transport implementations.
- **Web UI** — Yep Anywhere is the UI. The assistant format doesn't need its own dashboard.
- **Multi-model support** — Claude only. No model routing or fallback chains.
- **Skill marketplace/installation** — skills are directories in the engine repo, not installable packages. Community skills via git clone.
- **Real-time message listener daemon** — MVP uses cron for scheduled tasks and manual invocation for channel mode. A persistent listener for Signal/Telegram is a separate project.

## Milestones

### M1: Format + Tooling
- Schemas implemented and validated
- Build/index step working (scan SKILL.md → generate index in CLAUDE.md)
- Browser skill written in SKILL.md format (ported from yepanywhere)
- One assistant instance bootstrapped with soul + config
- Interactive mode works: `cd ~/assistant-data/assistants/my-assistant && claude`

### M2: Scheduled Tasks
- Schedule runner implemented
- Gmail skill working (IMAP read + digest)
- Reddit skill working (browser-based)
- System cron invoking morning-digest successfully
- Activity logging to JSONL

### M3: Channel Output
- Send CLI with Signal transport
- Channel mode invocation working
- pm-report delivering via Signal
- Self-lint + self-commit utilities

### M4: Memory + Self-Modification
- Assistant reads its own activity logs for context
- Assistant writes to learnings.md
- Assistant commits its own changes
- Feedback loop: assistant improves based on accumulated memory
