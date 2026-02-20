---
name: reddit
description: Scrape and summarize Reddit subreddits via the browser tool — extract posts, comments, and trends using old.reddit.com
---

# Reddit Scraping

Scrape subreddits to extract posts, comments, and trends. Uses the **browser** skill (must be available and running). Always use `old.reddit.com` — it's text-oriented and much better for automated extraction.

## Critical: Use `evaluate`, Not `snapshot`

**Never use `browser snapshot` for Reddit post listings.** The accessibility tree is far too verbose — old Reddit's nav, sidebar, and per-post UI chrome (upvote buttons, share links, flair badges) eat the entire token budget before reaching actual content. Even `--selector "#siteTable"` produces ~40 lines of tree nodes per post.

**Always use `browser evaluate` with JS** to extract structured data:

```bash
browser evaluate 'JSON.stringify([...document.querySelectorAll("#siteTable .thing")].map(el => ({ title: el.querySelector("a.title")?.textContent, score: el.querySelector(".score.unvoted")?.textContent, comments: el.querySelector(".comments")?.textContent, flair: el.querySelector(".linkflairlabel")?.textContent, url: el.querySelector("a.title")?.href, time: el.querySelector("time")?.getAttribute("title"), author: el.querySelector(".author")?.textContent })))'
```

This returns clean JSON in ~2-3KB instead of a 20KB+ truncated accessibility tree.

## Workflow

### 1. Start the browser

```bash
browser status
browser start
```

If startup fails with a timeout, kill stale Chrome processes first:
```bash
pkill -f "remote-debugging-port"
browser start
```

### 2. Open a subreddit

```bash
browser open https://old.reddit.com/r/localllama
```

For different sort orders:
```bash
browser open https://old.reddit.com/r/localllama/new
browser open https://old.reddit.com/r/localllama/top?t=day
browser open https://old.reddit.com/r/localllama/top?t=week
```

### 3. Extract post listing

Use the evaluate JS snippet above. Each post returns:
- `title` — post title
- `score` — upvote count (`"•"` means too new for a visible score)
- `comments` — e.g. `"89 comments"`
- `flair` — post flair label if any
- `url` — link to post or external URL
- `time` — submission timestamp
- `author` — poster username

### 4. Filter posts by keyword (optional)

Don't use Reddit's `restrict_sr=on` URL param — it's unreliable on old Reddit and returns results from all of Reddit. Filter client-side instead:

```bash
browser evaluate 'JSON.stringify([...document.querySelectorAll("#siteTable .thing")].filter(el => el.querySelector("a.title")?.textContent?.toLowerCase().includes("keyword")).map(el => ({ title: el.querySelector("a.title")?.textContent, score: el.querySelector(".score.unvoted")?.textContent, comments: el.querySelector(".comments")?.textContent })))'
```

### 5. Pagination

Old Reddit shows 25 posts per page. To get the next page URL:

```bash
browser evaluate 'document.querySelector(".next-button a")?.href'
```

Then `browser navigate` to that URL and extract again.

### 6. Read individual threads

For detailed comment reading, snapshots work better than for listings — but still scope them:

```bash
browser navigate <thread-url>
browser snapshot --selector ".commentarea" --efficient
```

Or use JS for structured top-level comments:

```bash
browser evaluate 'JSON.stringify([...document.querySelectorAll(".commentarea > .sitetable > .comment")].slice(0, 10).map(el => ({ author: el.querySelector(".author")?.textContent, score: el.querySelector(".score.unvoted")?.textContent, body: el.querySelector(".md")?.textContent?.substring(0, 500) })))'
```

### 7. Clean up

```bash
browser close    # close current tab when done with a subreddit
```

## Daily Digest Workflow

```
1. browser start (kill stale chrome first if needed)
2. For each configured subreddit:
   a. browser open https://old.reddit.com/r/<sub>
   b. evaluate JS to extract post listing
   c. Optionally check /new for latest posts
   d. For high-signal posts (high score, relevant keywords), click through and extract top comments
3. Compile digest:
   - Group by subreddit
   - Rank by score/relevance
   - Summarize key threads
   - Flag posts worth commenting on
4. browser close tabs when done
```

## Post Scoring Heuristic

- Score shown as `"•"` = too new to have a visible score
- 100+ upvotes in < 24h = notable
- High comment:score ratio = engagement/controversy
- Flair helps categorize: "Bug", "News", "Official" are usually higher signal than "Humor", "Praise"
