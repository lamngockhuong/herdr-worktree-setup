---
title: "ADR 0001: Bind repository trust to the commands it runs"
status: APPROVED
owner: Lam Ngoc Khuong
approver: Lam Ngoc Khuong
created: 2026-10-10
updated: 2026-10-10
ticket: none
reviewers:
  - Lam Ngoc Khuong (Tech Lead)
---

# ADR 0001: Bind repository trust to the commands it runs

## Context

`post_create` and `post_remove` run commands a repository chose, gated by `trusted-repos.txt` in the
plugin config directory. Each line held only a repository path (`src/commands.mjs:50-54`), while the
commands are read from whatever the main checkout currently holds (`src/config.mjs:90`). After a user
trusted a repository once, checking out any branch that edits those blocks, a pull request under
review for example, made the next worktree run the new commands with no prompt.

## Decision

- Each trust line is `<absolute path> sha256:<hex>`.
- The hash is SHA-256 over `JSON.stringify({ post_create, post_remove })`, taken from the parsed and
  normalized config before any variable is rendered. TOML formatting does not affect it; any change
  to a command string or to their order does. Other keys are not covered.
- A repository runs commands only when a line matches both its canonical path and that hash. Several
  lines for one path are allowed.
- Otherwise both blocks are skipped and the log prints the exact line to add, with the reason: not
  listed, listed without a hash, or commands changed.
- Path-only lines no longer grant trust. No automatic rewrite, no grace release.
- `HERDR_WORKTREE_SETUP_TRUST_ALL=1` bypasses the gate exactly as before.
- `--dry-run` asks the same gate, prints the hash in force or the line to add, and lists
  `post_remove` unrendered so the user reads everything the hash approves.

## Consequences

- Breaking change for every current user: each trusted repository has to be re-added once, using the
  line the log prints. Released as `0.4.0` (`bump-minor-pre-major`), with `!` in the squash-merged PR
  title and a `BREAKING CHANGE` footer.
- Editing either block requires re-trusting the repository; editing `copy`, `symlink`, `notify` or a
  timeout does not.
- The hash covers the command text, not the code a command executes: `pnpm install` still runs the
  checked-out branch's lifecycle scripts. The README says so.

## Alternatives rejected

- **Keep path-only lines valid alongside hashed ones:** leaves the hole open for exactly the people
  already using the plugin.
- **Pin the hash automatically on first run (trust on first use):** the first run after upgrading
  pins whatever is checked out, unread, and the plugin would write security state the user never
  wrote.
- **Read the commands from a fixed ref such as the default branch:** no reliable local definition of
  that ref, breaks editing commands on a feature branch, and splits where `copy` and the commands
  come from.
- **Hash the rendered commands:** they contain the branch and worktree path, so no line would ever
  match twice.
- **Hash the whole config file:** a harmless key change would demand re-approval.
- **Ask on every run:** the hook runs in the background with nobody to ask.
