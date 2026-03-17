# Git repository report

A quick health check for any git repository. Run with:

```
node sr.mjs examples/git-report.md
```

---

## Identity

Current branch, last commit, and working tree state.

```sh git log --oneline -1 && echo "branch: $(git branch --show-current)" | autorun
```

## Uncommitted changes

```sh
git status --short
```

## Recent history

Last 20 commits with author and relative date.

```sh
git log --oneline --format="%h %<(12,trunc)%an %cr  %s" -20
```

## Files changed most often

The hottest files in the last 100 commits — useful for spotting churn.

```bash
git log --name-only --format="" -100 | sort | uniq -c | sort -rn | head -20
```

## Contributors (last 90 days)

```sh
git log --since="90 days ago" --format="%an" | sort | uniq -c | sort -rn
```

## Branches

```sh
git branch -a --sort=-committerdate | head -20
```

## Large files in working tree

Files over 500KB that are tracked by git.

```bash
git ls-files | xargs -I{} sh -c 'size=$(wc -c < "{}"); [ "$size" -gt 500000 ] && echo "$size\t{}"' 2>/dev/null | sort -rn | head -10
```

## Stash

```sh
git stash list
```

## Unpushed commits

Commits on the current branch that haven't been pushed to origin.

```sh
git log @{u}..HEAD --oneline 2>/dev/null || echo "(no upstream set)"
```

---

## Notes

- All commands are read-only — safe to run in any repository
- Adjust `-20`, `--since`, and `--format` values to taste
- The "files changed most often" cell may be slow on large repositories — increase `data-cmd-timeout` if needed
