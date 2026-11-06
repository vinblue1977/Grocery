---
description: Ship the current work as a PR following CLAUDE.md
---

Ship the current changes as a pull request, following "Pull requests" and "Code review" in CLAUDE.md:

1. `gh pr list`. If one of our PRs is open (and this is not docs-only), stop and get that merged first.
2. `git pull` main, then branch from it with a conventional name if not already on a branch.
3. Run `/code-review` on the diff and fix what it finds (skip for docs-only changes).
4. `make check` (after the review fixes, so they are covered).
5. Commit with a conventional title, push, `gh pr create`, then `gh pr merge --auto --squash`.
6. After it merges: `gh pr update-branch <n>` on any other open PR of ours; `git fetch --prune` and delete local branches marked `gone`.

Extra instructions: $ARGUMENTS
