#!/usr/bin/env bash
# check-repos.sh — Scan directories for git repos and report sync status.
# Usage: check-repos.sh [dir1 dir2 ...] [--ignore=name1,name2] [--no-fetch]
#
# Exit code: 0 if all repos clean and synced, 1 if any need attention.

set -euo pipefail

DIRS=()
IGNORE=()
DO_FETCH=true

for arg in "$@"; do
  case "$arg" in
    --ignore=*) IFS=',' read -ra IGNORE <<< "${arg#--ignore=}" ;;
    --no-fetch) DO_FETCH=false ;;
    *) DIRS+=("$arg") ;;
  esac
done

if [ ${#DIRS[@]} -eq 0 ]; then
  DIRS=("$HOME/code")
fi

needs_attention=0
clean_count=0
skipped_count=0
problem_repos=()

for base_dir in "${DIRS[@]}"; do
  expanded=$(eval echo "$base_dir")
  if [ ! -d "$expanded" ]; then
    echo "WARNING: $expanded is not a directory, skipping"
    continue
  fi

  for repo_dir in "$expanded"/*/; do
    [ -d "$repo_dir/.git" ] || continue

    repo_name=$(basename "$repo_dir")

    # Check ignore list
    skip=false
    for ign in "${IGNORE[@]}"; do
      if [ "$repo_name" = "$ign" ]; then
        skip=true
        break
      fi
    done
    if $skip; then
      skipped_count=$((skipped_count + 1))
      continue
    fi

    issues=()

    # Fetch from remote
    if $DO_FETCH; then
      if ! git -C "$repo_dir" fetch --quiet 2>/dev/null; then
        issues+=("  fetch failed (no remote or network issue)")
      fi
    fi

    # Uncommitted changes
    dirty=$(git -C "$repo_dir" status --porcelain 2>/dev/null)
    if [ -n "$dirty" ]; then
      modified=$(echo "$dirty" | grep -c '^ M\| ^M\|^MM' || true)
      untracked=$(echo "$dirty" | grep -c '^??' || true)
      staged=$(echo "$dirty" | grep -c '^[MADRC]' || true)
      summary=""
      [ "$staged" -gt 0 ] && summary+="${staged} staged "
      [ "$modified" -gt 0 ] && summary+="${modified} modified "
      [ "$untracked" -gt 0 ] && summary+="${untracked} untracked"
      issues+=("  dirty: ${summary}")
    fi

    # Unpushed commits
    unpushed=$(git -C "$repo_dir" log @{u}..HEAD --oneline 2>/dev/null || echo "")
    if [ -n "$unpushed" ]; then
      count=$(echo "$unpushed" | wc -l | tr -d ' ')
      latest=$(echo "$unpushed" | head -1)
      issues+=("  unpushed: ${count} commit(s) — latest: ${latest}")
    fi

    # Unpulled commits
    unpulled=$(git -C "$repo_dir" log HEAD..@{u} --oneline 2>/dev/null || echo "")
    if [ -n "$unpulled" ]; then
      count=$(echo "$unpulled" | wc -l | tr -d ' ')
      issues+=("  behind remote: ${count} commit(s)")
    fi

    # Stashes
    stashes=$(git -C "$repo_dir" stash list 2>/dev/null)
    if [ -n "$stashes" ]; then
      count=$(echo "$stashes" | wc -l | tr -d ' ')
      issues+=("  stashes: ${count}")
    fi

    if [ ${#issues[@]} -gt 0 ]; then
      problem_repos+=("$repo_name")
      echo "$repo_name"
      for issue in "${issues[@]}"; do
        echo "$issue"
      done
      echo ""
      needs_attention=1
    else
      clean_count=$((clean_count + 1))
    fi
  done
done

echo "---"
if [ $needs_attention -eq 1 ]; then
  echo "${#problem_repos[@]} repo(s) need attention, ${clean_count} clean, ${skipped_count} skipped"
else
  echo "All ${clean_count} repos clean and synced (${skipped_count} skipped)"
fi

exit $needs_attention
