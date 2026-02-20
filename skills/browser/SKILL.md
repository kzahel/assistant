---
name: browser
description: Control a headless Chromium browser — navigate pages, read content via accessibility snapshots, interact with elements, fill forms, take screenshots
---

# Browser Control

You have access to a headless Chromium browser via a CLI. Use it to automate web tasks — checking websites, reading pages, filling forms, extracting information, scraping content.

## Setup

The browser server must be running. Check status and start it if needed:

```bash
browser status
browser start        # auto-starts Chrome on first use
```

If the server process isn't running at all, start it in the background first:

```bash
tsx ~/code/assistant/lib/browser/server.ts &
```

## CLI Reference

All commands below use `browser` as shorthand. The actual command path is configured per-instance — check the **Tool Paths** section of the assistant config.

### Navigation

```bash
browser open https://example.com           # Open URL in new tab
browser navigate https://example.com       # Navigate current tab
browser tabs                                # List open tabs
browser close [targetId]                    # Close tab
```

### Reading Pages

```bash
browser snapshot                  # Full accessibility snapshot
browser snapshot --efficient       # Shorter snapshot (~12k chars, cheaper)
browser snapshot --selector "main" # Scope to CSS selector
browser screenshot                # Take screenshot (returns file path)
browser screenshot --full          # Full page scroll capture
browser console                   # View console.log messages
```

### Interacting with Elements

```bash
browser click e5                    # Click element by ref
browser type e5 Hello world         # Type text into element
browser press Enter                  # Press keyboard key
browser hover e5                     # Hover over element
browser fill e3=John e4=john@x.com  # Fill multiple form fields
browser select e7 option1 option2   # Select dropdown values
browser evaluate document.title     # Run JavaScript
```

## Understanding Snapshots

The `snapshot` command returns an accessibility tree with element references. Example:

```
[url: https://news.ycombinator.com]
- heading "Hacker News" [level=1]
- navigation
  - link "new" [ref=e1]
  - link "comments" [ref=e2]
- main
  - list
    - listitem
      - link "Show HN: Something cool" [ref=e5]
      - text "142 points by user 3 hours ago"
      - link "89 comments" [ref=e6]
```

Element refs like `e5`, `e12` are how you reference elements in click/type/fill commands. They are assigned by Playwright's snapshot engine and **change between snapshots** — always re-snapshot after an action.

## Workflow Pattern

Always follow this loop:

1. **Snapshot** to see the current page state
2. **Identify** the element ref you need
3. **Act** (click, type, fill) using the ref
4. **Snapshot again** to verify the action worked

## Best Practices

- **Prefer snapshot over screenshot.** Snapshots are text (~3-5K tokens with --efficient). Screenshots require vision. Use snapshots for 90% of interactions.
- **Use --efficient for routine navigation.** Only use full snapshots for complex pages.
- **Use --selector to scope large pages.** Target the relevant section: `snapshot --selector "main"` or `snapshot --selector "#content"`.
- **Refs change between snapshots.** Always re-snapshot after acting to get fresh refs.
- **Use screenshot as fallback.** When the snapshot doesn't give enough context (visual layouts, images, CAPTCHAs), take a screenshot.
- **Check console for errors.** If something isn't working, `console` shows JavaScript errors.
- **The browser persists.** Login sessions, cookies, and history survive across CLI invocations and server restarts. User data is stored in a configured data directory.
- **Close the initial about:blank tab.** When Chrome starts, it opens an about:blank tab. After opening your first URL, close the blank tab using its targetId from `tabs`.

## Reddit Scraping Pattern

For monitoring subreddits:

1. Open the subreddit: `browser open https://old.reddit.com/r/localllama`
   - Use `old.reddit.com` — it's simpler, more text-oriented, better for snapshots
2. Snapshot with `--efficient` to get post titles, scores, and comment counts
3. For interesting posts, click through and snapshot the comments
4. Extract: title, score, comment count, top comments, and your assessment of whether it's worth engaging with

## Login-Required Sites

The browser maintains a persistent profile. If you've logged in before, cookies persist. If you need to log in:

1. Navigate to the login page
2. Snapshot to find the form fields
3. Fill credentials (from config/secrets, never hardcode)
4. Click submit
5. Verify login succeeded via snapshot
