---
name: browser
description: Control a headless Chromium browser — navigate pages, read content via accessibility snapshots, interact with elements, fill forms, take screenshots
---

# Browser Control

Headless Chromium browser via CLI for web automation.

## Setup

Check if the server is running, start if needed:

```bash
browser status
browser start        # auto-starts Chrome on first use
```

If the server process isn't running at all:

```bash
tsx ~/code/assistant/lib/browser/server.ts &
```

## CLI Reference

`browser` is shorthand — actual path is in the **Tool Paths** section of the assistant config.

### Navigation

```bash
browser open <url>              # New tab
browser navigate <url>          # Current tab
browser tabs                    # List tabs
browser close [targetId]        # Close tab
```

### Reading Pages

```bash
browser snapshot --efficient             # Accessibility tree (~12k chars)
browser snapshot --selector "main"       # Scope to element
browser evaluate "document.title"        # Run JS, return result
browser screenshot                       # PNG screenshot (returns path)
browser console                          # View JS console messages
```

**Choose the right tool:**
- **`snapshot --efficient`** — default for most pages. Text-based, cheap (~3-5K tokens).
- **`snapshot --selector "main"`** — large pages where nav/sidebar bloats the snapshot.
- **`evaluate`** — structured data extraction. Returns JSON. Best for scraping lists, tables, feeds.
- **`screenshot`** — visual layouts, images, CAPTCHAs. Requires vision. Use as fallback.

### Interacting with Elements

```bash
browser click e5                    # Click by ref
browser type e5 Hello world         # Type into element
browser press Enter                 # Keyboard key
browser fill e3=John e4=john@x.com  # Fill form fields
browser select e7 option1           # Select dropdown
```

## Snapshots

The `snapshot` command returns an accessibility tree with element refs:

```
[url: https://news.ycombinator.com]
- heading "Hacker News" [level=1]
- link "Show HN: Something cool" [ref=e5]
- text "142 points by user 3 hours ago"
- link "89 comments" [ref=e6]
```

Refs like `e5` are used in click/type/fill. They **change between snapshots** — always re-snapshot after acting.

## Workflow

1. **Snapshot** → see page state
2. **Act** (click/type/fill) using refs
3. **Snapshot again** → verify result

## Structured Data Extraction

For scraping lists, tables, or feeds, use `evaluate` with JS instead of parsing snapshots:

```bash
browser evaluate "JSON.stringify(Array.from(document.querySelectorAll('.item')).map(el => ({title: el.querySelector('a')?.textContent, url: el.querySelector('a')?.href})))"
```

This is faster, cheaper, and more reliable than parsing accessibility trees for bulk data.

### Reddit (old.reddit.com)

```bash
browser open https://old.reddit.com/r/<subreddit>/
browser evaluate "JSON.stringify(Array.from(document.querySelectorAll('#siteTable .thing.link')).map(t => ({title: t.querySelector('a.title')?.textContent, score: t.querySelector('.score.unvoted')?.textContent, comments: t.querySelector('.comments')?.textContent, time: t.querySelector('time')?.getAttribute('title'), flair: t.querySelector('.linkflairlabel')?.textContent, url: t.querySelector('a.title')?.href})))"
```

Always use `old.reddit.com` — simpler HTML, no infinite scroll, works with `evaluate`. Rate limit: 30s between subreddits.

## Login-Required Sites

The browser profile persists (cookies survive restarts). To log in:

1. Navigate to login page
2. Snapshot → find form refs
3. Fill credentials (from secrets, never hardcode)
4. Submit → snapshot to verify

## Troubleshooting

- **Connection refused:** Server isn't running. Start with `tsx ~/code/assistant/lib/browser/server.ts &`
- **Timeout on start:** Stale Chrome process holding the user-data lock. Kill it: `pkill -f 'chrome.*browser-control'` then retry.
- **Snapshot too large:** Use `--efficient` or `--selector "main"` to scope down.
- **Reddit blocked:** IP rate-limited. Wait 30s+ between requests. Log in for higher limits.
