# Competitive Analysis: Claw Starter vs BAREclaw

*February 2026*

## Executive Summary

BAREclaw and Claw Starter occupy adjacent but distinct positions in the personal AI assistant space. BAREclaw is a **thin multiplexing daemon** that routes messages from multiple channels into persistent Claude Code CLI sessions. Claw Starter is a **portable assistant format + engine** that defines assistant identity, skills, scheduling, and multi-mode invocation as a filesystem convention. Both aim to give users a personal AI assistant powered by Claude — but they disagree fundamentally on where the value lives.

**BAREclaw says:** "Claude Code is already a great agent. You just need a way to talk to it from anywhere."

**Claw Starter says:** "You need a portable identity layer that works with *any* agent runtime, not just Claude Code."

---

## At a Glance

| Dimension | Claw Starter | BAREclaw |
|-----------|-------------|----------|
| **One-liner** | Portable assistant format + engine for any agent runtime | Thin daemon multiplexing channels into Claude Code sessions |
| **Architecture** | No daemon — build step compiles CLAUDE.md, scheduler invokes sessions | Always-on Express server routing messages to persistent Claude processes |
| **Lines of code** | ~3,000+ (TypeScript) | ~1,690 (TypeScript) |
| **Runtime model** | Spawns fresh sessions per task/schedule; channel mode optional | Persistent long-running sessions per channel; context accumulates |
| **Agent coupling** | Agent-agnostic (Claude Code, Codex, Gemini CLI, Yep Anywhere) | Claude Code-specific (shells out to `claude -p`) |
| **Skills** | 5 built-in (browser, gmail, telegram, reddit, git-sync) via SKILL.md | None built-in — relies on Claude Code's native tools + MCP |
| **Channels** | Telegram (polling), email (SMTP), direct output | HTTP, Telegram (via Telegraf), extensible adapter model |
| **Scheduling** | Cron parser with timezone, state tracking, auto-disable on errors | Heartbeat system (hourly launchd/systemd timer) |
| **Configuration** | config.yaml + soul.md + user.md + heart.md + .env | Environment variables only (.env) |
| **Identity/Personality** | Rich: soul.md, user.md, heart.md, projects.md | SOUL.md with personality principles |
| **Memory** | learnings.md + activity-log.jsonl + per-topic files | Session persistence (.bareclaw-sessions.json) — context in conversation |
| **Security** | Inherits from agent runtime; glob-based permission rules for cron | Strips API keys from session env; Bearer token on HTTP; Telegram user allowlist |
| **License** | Not specified | MIT |

---

## Detailed Comparison

### 1. Core Architecture

**Claw Starter: Format-First**

Claw Starter's central idea is that an assistant is a directory of files:

```
~/.assistant-data/assistants/my-helper/
├── CLAUDE.md          # Compiled entry point
├── config.yaml        # Skills, schedules, preferences
├── soul.md            # Personality
├── memory/            # Self-recorded history
└── state/             # Skill checkpoints
```

A build step (`build.ts`) compiles these into a single CLAUDE.md that any agent can read. The scheduler spawns sessions on cron schedules. There is no persistent daemon managing conversations — each invocation is a fresh session (with optional session resumption in channel mode).

**BAREclaw: Daemon-First**

BAREclaw's central idea is a persistent process that owns Claude sessions:

```
Express Server (port 3000)
  ├── HTTP adapter (/message, /send, /restart)
  ├── Telegram adapter (Telegraf long-polling)
  └── ProcessManager
       ├── Channel "tg-123" → SessionHost → claude -p (persistent)
       ├── Channel "http"   → SessionHost → claude -p (persistent)
       └── Channel "heartbeat" → SessionHost → claude -p (persistent)
```

Each channel gets a dedicated Claude process that lives as long as the daemon runs. Sessions survive server restarts via session ID persistence and `--resume`.

**Implications:**

| Factor | Claw Starter advantage | BAREclaw advantage |
|--------|----------------------|-------------------|
| **Conversation continuity** | Must be handled via file-based history | Native — session context accumulates for days/weeks |
| **Resource usage** | Zero when idle (no daemon) | Always-on process (Express + per-channel Claude processes) |
| **Crash recovery** | Nothing to crash | Session hosts are detached, survive server restart |
| **Multi-turn conversations** | Possible via channel mode but not primary pattern | Primary design pattern; message coalescing handles rapid-fire input |
| **Portability** | Works with any agent that reads CLAUDE.md | Locked to Claude CLI |

### 2. Skills & Capabilities

**Claw Starter: Built-In Operational Skills**

Ships with 5 production-ready skills, each with a CLI tool and a SKILL.md instruction file:

- **Browser** — Headless Chromium via Playwright with stealth, accessibility snapshots, structured extraction
- **Gmail** — IMAP/SMTP with state tracking (UID cursor), digest workflows
- **Telegram** — Bot API messaging with markdown, auto-splitting
- **Reddit** — Subreddit scraping via old.reddit.com, daily digest patterns
- **Git Sync** — Multi-repo health checks (uncommitted, unpushed, behind remote)

Skills follow the AAIF SKILL.md standard — portable across Claude Code, Codex, Copilot, Cursor, Gemini CLI.

**BAREclaw: Delegate to Claude Code**

Ships with zero custom skills. Instead, it gives Claude Code full tool access (`Read, Glob, Grep, Bash, Write, Edit, Skill, Task`) and lets the agent use its native capabilities. Any MCP servers or CLAUDE.md-level skills available in the project are automatically accessible.

**Analysis:**

Claw Starter's approach is more opinionated and immediately useful — a new user gets email digests, Reddit monitoring, and browser automation out of the box. BAREclaw's approach is more flexible but requires users to set up their own tooling. The SKILL.md standard gives Claw Starter cross-tool portability that BAREclaw can't match.

However, BAREclaw's "just use Claude Code" philosophy means it automatically benefits from any Claude Code improvements without effort. New Claude Code features (MCP, skills, etc.) are available instantly.

### 3. Channel & Messaging Model

Both projects share the same core transport architecture:

- **Session executor abstraction** — Claw Starter's `SessionExecutor` interface (`start`, `resume`, `poll`, `cleanup`) maps directly to BAREclaw's `ProcessManager.send()`. Same decoupling of "how to run Claude" from "how to route messages."
- **Per-channel session persistence** — Both store session IDs keyed by channel in JSON files and use `--resume` to continue conversations.
- **Polling + typing indicators** — Both poll active sessions and send typing actions to Telegram.
- **Channel abstraction** — Claw Starter's `ChannelTransport` interface and BAREclaw's adapter pattern serve the same role — thin wrappers over transport-specific APIs.

**Where Claw Starter is ahead:**

- **Multi-executor support**: Claude CLI + Yep Anywhere. BAREclaw only supports Claude CLI.
- **Permission approval via Telegram**: Inline keyboard approve/deny buttons for tool permission requests — BAREclaw doesn't have this.
- **Voice transcription**: Audio messages are transcribed and forwarded to Claude.
- **Multi-user support**: Per-user session tracking with named users. BAREclaw uses a flat user ID allowlist.

**Where BAREclaw is ahead:**

- **HTTP adapter**: `POST /message` and `POST /send` endpoints enable Apple Shortcuts, webhooks, and other HTTP-based triggers without Telegram.
- **Message coalescing**: If 3 messages arrive while a turn is processing, they're joined into one turn. Claw Starter dispatches each message separately.
- **Streaming event callbacks**: BAREclaw's `onEvent` callback gets real-time Claude events during a turn (tool use, text chunks), enabling in-place status messages and collapsible diffs in Telegram. Claw Starter's executor fires-and-forgets without intermediate events.
- **Detached session host processes**: BAREclaw spawns a separate process per channel that communicates via Unix socket. Claude processes literally survive server restarts without needing to re-spawn. Claw Starter's sessions survive via `--resume` (which replays context), but Claude must be re-spawned.
- **Rich Telegram UX**: In-place tool activity status line, collapsible diffs for Edit operations, collapsible previews for Write operations — UI polish on top of the streaming events.

**Analysis:**

The core transport designs are fundamentally the same pattern. The differences are at the edges: Claw Starter has more executor flexibility and interactive permission controls; BAREclaw has more Telegram UI polish and the HTTP adapter. Neither transport layer is categorically better — they've made different tradeoffs.

### 4. Scheduling & Automation

**Claw Starter: Full Cron System**

- Cron expressions with timezone support
- Per-schedule skill chaining (run gmail + reddit + git-sync in one job)
- State tracking: `consecutiveErrors`, `lastRunAt`, auto-disable at 5+ failures
- Output routing: results sent to configured channel(s)
- Custom prompts per schedule
- 30-second check loop with 5-second channel polling

**BAREclaw: Heartbeat Pattern**

- Single hourly timer via launchd (macOS) or systemd (Linux)
- Messages the `"heartbeat"` channel — a persistent Claude session
- Context accumulates: tell heartbeat "every hour, check X" and it remembers
- Auto-install during server startup
- Fallback: standard cron jobs that POST to `/message`

**Analysis:**

Claw Starter has a more structured and capable scheduling system. Multiple schedules, per-schedule skill configuration, error tracking with auto-disable, and timezone support make it production-ready for complex automation.

BAREclaw's heartbeat is elegant in its simplicity — it's just another channel with accumulated context — but it lacks granular scheduling (everything runs hourly), error handling, and skill-specific configuration. For users who want "check email at 7am, reddit at noon, git at 6pm," Claw Starter is significantly better.

### 5. Identity & Personality

**Claw Starter: Decomposed Identity**

- `soul.md` — Personality, communication style, values
- `user.md` — User identity, preferences, accessibility needs
- `heart.md` — Pronouns, emotional registers, communication boundaries
- `projects.md` — Active project reference table
- All compiled into CLAUDE.md at build time

**BAREclaw: Single Personality File**

- `SOUL.md` — Personality principles ("helpful, honest, concise, dry humor"), tool philosophy, engineering principles
- `CLAUDE.md` — Operational instructions for the agent

**Analysis:**

Claw Starter's decomposed identity is more expressive and separates concerns well (who the assistant is vs. who the user is vs. what projects exist). BAREclaw's approach is simpler but sufficient for most single-user setups.

### 6. Memory & Persistence

**Claw Starter: Structured File-Based Memory**

- `memory/learnings.md` — Self-recorded insights (the assistant writes to this)
- `memory/activity-log.jsonl` — Structured JSONL history of past action
- `memory/topics/` — Per-topic detailed notes
- `state/` — Skill checkpoints (last email UID, last Reddit scan, telegram offset, etc.)
- Git history serves as audit trail for all self-modifications

**BAREclaw: No Memory System**

BAREclaw has no memory layer at all. The entire persistence layer is a single file — `.bareclaw-sessions.json` — which maps channel strings to session IDs. There are no memory files, no activity logs, no learnings, no state checkpoints.

"Memory" in BAREclaw is purely implicit: conversation history lives in the Claude session's 200K context window. The SOUL.md states *"You remember. Your session persists. If someone told you something yesterday, you know it today."* This relies entirely on Claude's session context surviving across messages. If a session compacts, if the session host dies without a valid resume ID, or if context simply gets too large, accumulated knowledge is lost with no recovery path.

Behavioral preferences are persisted by editing `SOUL.md` directly (CLAUDE.md instructs: *"When the user requests a behavioral change or preference, persist it to SOUL.md so it carries across sessions"*). This conflates personality definition with runtime state.

**Analysis:**

This is one of the largest gaps between the two projects. Claw Starter has a real, durable, inspectable memory system — activity logs can be searched, learnings persist across sessions, and state checkpoints enable reliable automation (e.g., "process only emails newer than last seen"). The git audit trail means nothing is ever truly lost. BAREclaw has no equivalent. For any use case involving scheduled tasks, multi-session continuity, or auditability, the lack of structured memory is a significant limitation.

### 6b. Engine / Instance Separation

**Claw Starter: Two-Repo Architecture**

Claw Starter cleanly separates the public engine (skills, tools, build system, scheduler) from private instance data (identity, secrets, memory, state):

```
claw-starter/                              # Engine — public, shareable, updatable
  lib/, skills/, templates/

~/.assistant-data/assistants/<name>/       # Instance — private, personal
  config.yaml, soul.md, user.md, memory/, state/, .env
```

Multiple assistants can share the same engine. The engine can be updated independently of personal data. The engine can be shared publicly while keeping identity private.

**BAREclaw: Single Repo, No Separation**

BAREclaw is a single repository with no engine/instance boundary:

```
bareclaw/
  src/          # daemon code
  CLAUDE.md     # identity instructions
  SOUL.md       # personality
  .env          # secrets
```

Infrastructure, identity, and configuration all live in the same directory. The `BARECLAW_CWD` env var controls which directory Claude uses as its working context, but this is just "which cwd to spawn Claude in" — not a structured instance format with defined schemas.

Running two different assistants with different personalities would require two full clones of the repo. There's no concept of "install the engine once, create multiple instances."

**Analysis:**

Claw Starter's separation is a significant architectural advantage for anyone who wants multiple assistants, wants to share the engine, or wants to keep personal data cleanly isolated from updatable infrastructure. BAREclaw's single-repo approach is simpler for the single-user, single-assistant case but doesn't scale to multiple identities or collaborative development of the engine.

### 7. Security Model

**Claw Starter:**

- Inherits permissions from underlying agent runtime
- Glob-based permission rules for cron tasks (`CRON_PERMISSIONS`)
- Can deny specific bash patterns (e.g., prevent scraped content from executing code)
- `.env` for secrets, gitignored
- Agent self-modification gated by lint + commit

**BAREclaw:**

- Strips `ANTHROPIC_API_KEY` from session host environment
- Bearer token authentication on HTTP endpoints
- Telegram user allowlist (`BARECLAW_ALLOWED_USERS`, mandatory)
- `--max-turns` prevents runaway loops
- Session hosts run as detached processes (isolation)

**Analysis:**

Both take security seriously but in different domains. Claw Starter focuses on what the agent is allowed to *do* (permission rules for automated tasks). BAREclaw focuses on who is allowed to *talk* to the agent (auth on HTTP, allowlist on Telegram). BAREclaw's API key stripping is a nice touch that Claw Starter doesn't address.

---

## Strategic Analysis

### Where BAREclaw Wins

1. **Simplicity**: 1,690 lines, env-var config, no build step. Getting started is `npm install && npm run dev && curl localhost:3000/message`. Lower barrier to entry for developers who just want to talk to Claude from Telegram.

2. **HTTP adapter**: The `POST /message` and `POST /send` endpoints enable webhooks, Apple Shortcuts, and other HTTP-based integrations without Telegram.

3. **Streaming events + rich Telegram UX**: Real-time tool activity, collapsible diffs, and filler suppression make the Telegram experience more polished.

4. **Detached session hosts**: Claude processes survive server restarts without needing to re-spawn and replay context.

5. **Self-modification**: Claude can edit BAREclaw's own source code and trigger a restart.

### Where Claw Starter Wins

1. **Portability**: Works with Claude Code, Codex, Gemini CLI, Yep Anywhere, or any agent that reads CLAUDE.md. BAREclaw is locked to `claude -p`. If a better agent runtime emerges, Claw Starter users can switch; BAREclaw users must rewrite.

2. **Built-in skills**: Browser automation, email, Reddit scraping, git monitoring — functional out of the box. BAREclaw ships nothing; users must wire up their own capabilities.

3. **Scheduling**: Full cron system with per-schedule skill chaining, timezone support, error tracking, and auto-disable. BAREclaw's hourly heartbeat is too coarse for production automation.

4. **Structured memory**: Activity logs, learnings, state checkpoints — durable, inspectable, and queryable. BAREclaw's session-based memory is ephemeral and opaque.

5. **Standards alignment**: SKILL.md (AAIF), AGENTS.md compatibility. Skills are portable across tools. BAREclaw doesn't engage with the emerging standards ecosystem.

6. **Rich identity model**: Decomposed soul/user/heart/projects files vs. a single SOUL.md. Better separation of concerns for complex assistant personalities.

7. **Two-repo architecture**: Clean separation of public engine (shareable, updatable) from private instance data (personal, secret). BAREclaw is a single repo with user config mixed in.

### Where Neither Wins (Shared Gaps)

1. **Multi-agent coordination**: Neither supports agent teams, delegation, or swarm patterns.
2. **Web UI**: Neither has a web dashboard or admin interface.
3. **Voice**: Neither supports voice input/output.
4. **Mobile**: Neither has a native mobile app (though both can be reached via Telegram).
5. **Onboarding**: Both require developer-level setup (git clone, npm install, env vars). No installer, no GUI setup wizard.

---

## Complementarity & Convergence

These projects are more complementary than competitive. A hybrid approach could combine the best of both:

| From BAREclaw | From Claw Starter |
|---------------|-------------------|
| Persistent daemon with session management | Portable assistant format (soul.md, config.yaml, SKILL.md) |
| Message coalescing and channel adapter model | Built-in operational skills (browser, email, reddit) |
| Rich Telegram UX (status, diffs, questions) | Full cron scheduling with error tracking |
| Session host crash recovery | Structured memory (activity logs, learnings, state) |
| Self-modification with restart | Two-repo engine/instance separation |

**BAREclaw could adopt Claw Starter's format** — use soul.md/config.yaml for identity and skills, SKILL.md for portable capability definitions, and structured memory files instead of relying solely on session context.

**Claw Starter could adopt BAREclaw's daemon model** — add a persistent server mode with session management, message coalescing, and richer channel adapters for interactive use cases.

---

## Recommendations for Claw Starter

Based on this analysis, areas where Claw Starter could learn from BAREclaw:

1. **Message coalescing**: When receiving rapid-fire messages in channel mode, coalesce them into a single turn instead of dispatching separate sessions.

2. **Streaming event callbacks**: Adding an `onEvent` callback to the executor interface would enable richer Telegram UX (in-place status, collapsible diffs) without changing the core architecture.

3. **HTTP adapter**: A simple HTTP endpoint for receiving messages would enable Apple Shortcuts, webhooks, and other integrations without requiring Telegram.

4. **Self-restart capability**: Allow the agent to modify engine code and trigger a rebuild + restart, enabling the "agent improves its own tools" feedback loop.

---

## Conclusion

BAREclaw and Claw Starter represent two coherent but different philosophies for personal AI assistants:

- **BAREclaw** is a **transport layer** — it solves the problem of reaching Claude Code from anywhere, with excellent conversational UX and minimal complexity. It bets that Claude Code itself is sufficient and just needs better accessibility.

- **Claw Starter** is an **identity and capability layer** — it solves the problem of making any agent into a persistent, capable personal assistant with skills, scheduling, and memory. It bets that portability and structured operations matter more than conversational polish.

For users who primarily want a chat assistant they can reach from Telegram, BAREclaw's simplicity and session persistence make it immediately compelling. For users who want an autonomous assistant that monitors email, scrapes the web, and runs scheduled tasks across multiple agent runtimes, Claw Starter's operational capabilities are unmatched.

The strongest position would combine both: Claw Starter's portable format and operational skills running behind BAREclaw's channel multiplexing and session management. The projects address different layers of the same stack and would benefit from interop rather than competition.
