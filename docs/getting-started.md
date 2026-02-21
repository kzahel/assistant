# Getting Started

Set up a working Claw with Telegram and Gmail in about 10 minutes.

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — required for interactive use and the scheduler
- Node.js 18+ with `tsx` installed (`npm i -g tsx`)
- A Telegram account
- A Gmail account with 2-factor authentication enabled

## 1. Create an instance

```bash
mkdir -p ~/.assistant-data/assistants/myclaw
echo 'name: MyClaw' > ~/.assistant-data/assistants/myclaw/config.yaml
```

## 2. Set up Telegram

You need a bot token and your chat ID.

### Create a bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Choose a name and username (username must end in `bot`)
4. BotFather gives you a token like `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`

### Get your chat ID

Add the token to your `.env` and run:

```bash
echo 'TELEGRAM_BOT_TOKEN=your-token-here' > ~/.assistant-data/assistants/myclaw/.env
npx tsx lib/telegram-cli.ts get-chat-id  # run from claw-starter repo
```

Then send any message to your bot in Telegram. The CLI prints your chat ID. Add it to `.env`:

```
TELEGRAM_BOT_TOKEN=your-token-here
TELEGRAM_CHAT_ID=123456789
```

### Update config

```yaml
# config.yaml
name: MyClaw

skills:
  telegram:
    chatId: "123456789"
```

## 3. Set up Gmail

Gmail requires an **app password** — your regular password won't work. 2-factor authentication must be enabled first.

### Enable 2FA (if not already)

Go to [Google Account Security](https://myaccount.google.com/security) and enable 2-Step Verification.

### Create an app password

1. Go to [https://myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
2. Enter a name (e.g. "claw")
3. Google gives you a 16-character password like `abcd efgh ijkl mnop`

### Add to .env and config

Append to `.env`:

```
GMAIL_APP_PASSWORD=abcdefghijklmnop
```

Update `config.yaml`:

```yaml
name: MyClaw

skills:
  telegram:
    chatId: "123456789"
  gmail:
    account: you@gmail.com
    sendTo: you@gmail.com
    folders: [INBOX]
    maxAge: 24h
```

## 4. Build and run

```bash
npx tsx lib/build.ts --instance ~/.assistant-data/assistants/myclaw  # run from claw-starter repo
cd ~/.assistant-data/assistants/myclaw && claude
```

Your Claw is running. Try asking it to check your email or send you a Telegram message.

## 5. Start the scheduler

The scheduler runs scheduled tasks (cron) and polls Telegram for incoming messages. Without it, your bot won't respond to Telegram messages and schedules won't fire.

Ask your agent to start it:

> Start the scheduler service for me.

Or run it directly from the claw-starter repo:

```bash
npx tsx lib/scheduler.ts --instance ~/.assistant-data/assistants/myclaw
```

The scheduler uses `claude` as the default executor. Codex support isn't built yet — but the executor interface is simple, so you can ask Codex (or Claude) to add it. To keep the scheduler running persistently, set it up as a systemd user service or launchd agent.

## 6. Make it yours

The fastest way to personalize your Claw is to let it interview you. Once it's running, just say:

> Interview me like you're writing my obituary. Ask about my life, career, interests, what I care about. Then write soul.md and user.md based on what you learn.

It'll ask you questions, then write its own personality and context files. It knows how to rebuild itself — no manual steps needed.

## 7. What now?

Just ask it to do things. It'll figure out the config, schedules, and skills on its own.

- "Send me a summary of my inbox every morning at 7am"
- "Check r/programming for anything about Rust and message me on Telegram"
- "How many git commits did I make today?"
- "Set up a daily digest of my GitHub notifications"

If it needs a skill it doesn't have configured, it'll tell you what's missing.
