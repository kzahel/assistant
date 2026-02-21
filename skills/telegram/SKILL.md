---
name: telegram
description: Send and receive messages via Telegram — notifications, reports, and two-way messaging with a Telegram bot
---

# Telegram

Send and receive messages via the Telegram Bot API. Used for notifications, report delivery, and as a messaging channel for the assistant.

## Prerequisites

- A Telegram bot created via [@BotFather](https://t.me/BotFather)
- Bot token stored in the assistant's `.env` file as `TELEGRAM_BOT_TOKEN`
- Chat ID stored in `.env` as `TELEGRAM_CHAT_ID` (run `telegram get-chat-id` to obtain)

## Sending Messages

```bash
# Inline message (sent as HTML by default)
telegram send --message "<b>bold</b> and <i>italic</i>"

# Read from file, convert markdown to HTML
telegram send --message-file /path/to/report.md --markdown

# Pipe from stdin
echo "Hello from Scout" | telegram send

# Pipe markdown through stdin with conversion
cat /path/to/report.md | telegram send --markdown

# Plain text (no formatting)
telegram send --message "plain text, no parsing" --no-parse

# Explicit recipient
telegram send --to <chat-id> --message "Hello"
```

### Input Priority

1. `--message` — inline text
2. `--message-file` — read from file
3. stdin — piped input

### Formatting Modes

| Flag | parse_mode | Input | Use case |
|------|-----------|-------|----------|
| (default) | HTML | Write HTML directly | When you control the markup |
| `--markdown` | HTML | Write markdown, CLI converts to HTML | Reports, rich content from files |
| `--no-parse` | (none) | Plain text | Chat replies, avoid escaping issues |
| `--parse X` | X | Raw text in that mode | Override (e.g. `--parse MarkdownV2`) |

### Message Limits

Telegram limits messages to 4096 characters. The CLI auto-splits longer messages.

### Sending Best Practices

- **Keep messages concise.** Telegram is a phone screen — short paragraphs, bullets.
- **Use `--markdown` with `--message-file`** for rich content — avoids shell escaping and keeps content out of agent context.
- **Use `--no-parse` for chat replies** where content might contain special characters.
- **Don't spam.** Batch updates into a single message when possible.

## Receiving Messages

```bash
telegram poll                          # Long-poll for new messages (30s timeout)
telegram poll --timeout 60             # Custom timeout
telegram poll --offset <update-id>     # Resume from specific update
```

### Poll Output Format

```
[2026-02-21T07:00:00Z] @kzahel (chat:123456789): Check on JSTorrent waitlist
  update_id: 987654321
```

## Utility Commands

```bash
telegram get-me                        # Verify bot token, show bot info
telegram get-chat-id                   # Wait for someone to message the bot, print their chat ID
```

## Configuration

In `config.yaml`:

```yaml
skills:
  telegram:
    chatId: "123456789"    # Default recipient
```

Secrets in `.env`:

```
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_CHAT_ID=123456789
```

## Using as Output Channel

Set `output: telegram` on a schedule to deliver results via Telegram instead of email:

```yaml
schedules:
  - name: quick-alert
    cron: "*/30 * * * *"
    skills:
      - skill: some-check
    output: telegram
```

The assistant should format the output as a concise Telegram message (plain text or light Markdown).
