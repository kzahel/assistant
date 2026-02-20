---
name: git-sync
description: "Scan local git repos for dirty trees, unpushed/unpulled commits, and stashes — keep machines in sync"
---

# git-sync

Check all git repositories for sync issues: uncommitted changes, unpushed commits, commits behind remote, and stashes.

## Usage

Run the check script using the `git-sync` tool path:

```bash
git-sync [dir1 dir2 ...] [--ignore=name1,name2] [--no-fetch]
```

### Arguments

- **dirs** — Directories to scan (default: `~/code`). Each immediate subdirectory containing `.git/` is checked.
- **--ignore=name1,name2** — Comma-separated repo names to skip.
- **--no-fetch** — Skip `git fetch` (faster, but won't detect unpulled commits).

### Config

The skill config provides defaults:

```yaml
git-sync:
  codeDirs:
    - ~/code
  ignoreDirs:
    - agent-os
```

Build the CLI args from config: pass each `codeDirs` entry as a positional arg, and join `ignoreDirs` into `--ignore=`.

### Example

```bash
git-sync ~/code --ignore=agent-os
```

## Output

The script prints each repo that needs attention with its issues, then a summary line:

```
yepanywhere
  dirty: 2 modified 1 untracked
  unpushed: 3 commit(s) — latest: abc1234 Fix thing

dotfiles
  behind remote: 2 commit(s)

---
2 repo(s) need attention, 15 clean, 1 skipped
```

Exit code 0 = all clean, 1 = something needs attention.

## Behavior by trigger mode

- **Interactive:** Run the check, report results. If repos need attention, offer to fix them (pull, push, show diffs). Ask before taking action.
- **Cron/Channel:** Run the check, report results only. Don't attempt fixes — just flag what needs attention.

## Fixing issues

When in interactive mode and repos need attention:

- **Dirty tree:** Show `git diff --stat` for the repo. Ask if user wants to commit, stash, or leave it.
- **Unpushed:** Ask if user wants to push.
- **Behind remote:** Ask if user wants to pull (warn if tree is also dirty — suggest stash first).
- **Stashes:** Just mention them. Don't offer to pop unless asked.

Never force-push or reset without explicit user request.
