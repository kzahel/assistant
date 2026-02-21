# Getting Started

Set up a working Claw with Telegram and Gmail in about 10 minutes.

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (or Codex, Gemini CLI, etc.)
- Node.js 18+ with `tsx` installed (`npm i -g tsx`)
- A Telegram account
- A Gmail account with 2-factor authentication enabled

## 1. Create an instance

```bash
mkdir -p ~/.assistant-data/assistants/myclaw
cat > ~/.assistant-data/assistants/myclaw/config.yaml << 'EOF'
name: MyClaw
EOF
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
tsx ~/code/assistant/lib/telegram-cli.ts get-chat-id
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
tsx ~/code/assistant/lib/build.ts --instance ~/.assistant-data/assistants/myclaw
cd ~/.assistant-data/assistants/myclaw && claude
```

Your Claw is running. Try asking it to check your email or send you a Telegram message.

## 5. Optional: add personality

Create `~/.assistant-data/assistants/myclaw/soul.md`:

```markdown
You are MyClaw, a no-nonsense assistant.
Keep answers short. Prefer action over discussion.
```

Rebuild after any file change:

```bash
tsx ~/code/assistant/lib/build.ts --instance ~/.assistant-data/assistants/myclaw
```

## Next steps

- Add a schedule in `config.yaml` to run tasks on a cron
- Enable the browser skill for web automation
- Create `user.md` and `projects.md` to give your Claw context about you
- Check `docs/design/` for the full format spec
