---
name: gmail
description: Read and send email via Gmail — fetch inbox, summarize messages, send reports and notifications via IMAP/SMTP
---

# Gmail

Read email via IMAP and send email via SMTP using Gmail app passwords. Used for inbox monitoring, digest generation, and sending reports.

## Prerequisites

- A Gmail account with an [app password](https://myaccount.google.com/apppasswords) (requires 2FA enabled)
- App password stored in the assistant's `.env` file as `GMAIL_APP_PASSWORD`
- Account email configured in `config.yaml`

## Reading Email (IMAP)

Use the `gmail` CLI tool to read email:

```bash
gmail inbox                        # Fetch unread messages from INBOX
gmail inbox --folder "INBOX"       # Specify folder
gmail inbox --max-age 24h          # Only messages from last 24 hours
gmail inbox --limit 20             # Max messages to fetch
gmail read <message-id>            # Read full message body
```

### Inbox Output Format

```
From: sender@example.com
Subject: Weekly team update
Date: 2026-02-20T09:15:00Z
ID: msg-12345
Snippet: Here are the highlights from this week...
---
From: notifications@github.com
Subject: [repo] New issue: Bug in login flow
Date: 2026-02-20T08:30:00Z
ID: msg-12346
Snippet: @user opened a new issue...
```

### Summarization Pattern

When generating an inbox digest:

1. Fetch recent messages: `gmail inbox --max-age 24h`
2. Group by importance:
   - **Action required** — messages that need a response or decision
   - **FYI** — informational, worth knowing about
   - **Noise** — automated notifications, marketing, can be skipped
3. For action-required messages, read the full body if the snippet isn't enough
4. Summarize concisely — sender, subject, what's needed, urgency

## Sending Email (SMTP)

```bash
gmail send --to recipient@example.com --subject "Daily Report" --body "Report content here..."
gmail send --to recipient@example.com --subject "Alert" --body-file /path/to/report.md
gmail send --to recipient@example.com --subject "Report" --html --body-file /path/to/report.html
```

### Sending Best Practices

- **Keep reports concise.** Email bodies should be scannable — use short paragraphs and bullet points.
- **Use plain text by default.** Only use `--html` when formatting genuinely helps (tables, links).
- **Subject lines should be informative.** "[Assistant] Daily Digest — Feb 20" not "Report".
- **Don't send empty reports.** If there's nothing noteworthy, skip the email or send a one-liner.

## State Tracking

The skill tracks which messages have been seen to avoid re-processing:

- State file: `state/gmail-last-seen.json`
- Contains: `{ "uidNext": 12345, "lastMessageId": "msg-xxx", "lastRun": "2026-02-20T07:00:00Z" }`
- Updated after each successful inbox fetch

## Configuration

In `config.yaml`:

```yaml
skills:
  gmail:
    account: user@gmail.com
    folders: [INBOX]
    maxAge: 24h
    sendFrom: user@gmail.com    # defaults to account
```

Secrets in `.env`:

```
GMAIL_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
```
