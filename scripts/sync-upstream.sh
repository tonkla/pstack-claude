#!/bin/sh
set -eu

# Rebase local main onto upstream main instead of merging.
# Usage: sh scripts/sync-upstream.sh
#
# Fetches upstream, replays local main on top of upstream/main with no
# merge commit, then pushes the result to origin. Commits upstream already
# absorbed are dropped automatically (--empty=drop). If the rebase stops
# on a conflict, resolve the files, run `git rebase --continue`, and run
# this script again to finish the push.
UPSTREAM_URL="git@github.com:michael-denyer/pstack-claude.git"
BRANCH="main"

current=$(git branch --show-current)
if [ "$current" != "$BRANCH" ]; then
  echo "error: run this from the '$BRANCH' branch (current: '$current')" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is not clean; commit, stash, or restore first" >&2
  exit 1
fi

if ! git remote get-url upstream >/dev/null 2>&1; then
  git remote add upstream "$UPSTREAM_URL"
fi

git fetch upstream
git rebase --empty=drop "upstream/$BRANCH"
bun tools/generate.mjs --check
git push --force-with-lease origin "$BRANCH"
