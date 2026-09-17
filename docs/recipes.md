# Recipes

**English** · [Tiếng Việt](recipes.vi.md)

The [README](../README.md) documents every key and every variable: what they accept and how they behave. This file answers the other question — *which of them do I actually need, and when?*

Each recipe is a situation you may recognise, the smallest configuration that solves it, and what to watch out for afterwards. Nothing here is required reading; a repository that needs none of it still works with no configuration at all.

## A monorepo where every package has its own `.env`

**The situation.** `apps/api`, `apps/web` and `packages/database` each carry an `.env.local` that took an afternoon to fill in. A fresh worktree has none of them.

**The configuration.** None. Detection walks the whole repository, and every one of those files is both git-ignored and shaped like configuration, so all of them are copied.

Confirm it before you trust it:

```bash
herdr plugin action invoke lamngockhuong.worktree-setup.dry-run
```

**What to watch.** If the preview lists a file you would rather leave behind — a `.env.ci` that only CI should ever read — drop it without touching the rest of the detection:

```toml
exclude = ["**/.env.ci"]
```

## Two dev servers running at once

**The situation.** You keep one worktree on the branch under review and another on the branch you are writing. Both run `pnpm dev`, both ask for port 3000, and the second one dies with `EADDRINUSE`.

**The configuration.** Write the port into the environment the dev server reads, and start the server yourself:

```toml
post_create = ["pnpm install", "printf 'PORT=%s\\n' {{ branch | hash_port }} >> .env.local"]
```

**What to watch.** `post_create` is not where a dev server goes. Each command must finish before the next one starts, so a server left in the foreground holds the hook until the timeout kills it and reports a failed run. Give the port to the worktree, as above, and start the server when you are ready — or start it detached.

Note where the placeholder sits: bare, not inside quotes of your own. The plugin quotes every substituted value, so `'PORT={{ branch | hash_port }}'` would reach the shell as `'PORT='13706''` and mean something else entirely. `printf` takes the number as its own argument, which is why this form is safe.

On Windows, `printf` is not available and the line needs a PowerShell equivalent; see the Windows recipe below.

`hash_port` is a pure function of the branch name, so `feature/checkout` claims 13706 on every run and `fix/login` claims 18690 on every run. The port follows the branch rather than the order you opened the worktrees in, which is what makes it safe to bookmark.

Two different branches can still collide — 10000 ports and a hash make that unlikely, not impossible. When it happens, renaming one branch moves it.

## A Docker Compose stack per branch

**The situation.** Every branch needs its own Postgres. Run `docker compose up` in two worktrees and the second one adopts the first one's containers, because Compose derives its project name from the directory and both are named after the same repository.

**The configuration.**

```toml
post_create = ["docker compose -p {{ repo_name }}-{{ branch | sanitize }} up -d"]
post_remove = ["docker compose -p {{ repo_name }}-{{ branch | sanitize }} down -v"]
```

**What to watch.** The project name namespaces containers, networks and volumes together, so each branch gets its own database with its own data. `sanitize` is not optional here: `feature/checkout` is a legal branch name and an illegal Compose project name, and the `/` has to become `-`.

`post_remove` is what stops a week of worktrees from becoming a week of abandoned databases. It runs in the repository rather than the worktree, because Herdr fires the removal event after the checkout is deleted — which is exactly why both entries name the stack instead of pointing at a file inside it.

## Dependencies: install per branch, or link one tree?

**The situation.** `node_modules` takes two minutes to build, and you open worktrees often.

**The configuration** depends on one question — *do your branches change the lockfile?*

```toml
# Branches change dependencies. Pay the install; it is the only correct answer.
post_create = ["pnpm install"]
```

```toml
# Branches never touch the lockfile. Share one tree and start instantly.
symlink = ["node_modules"]
```

**What to watch.** A linked `node_modules` means the worktree runs the *main* checkout's dependencies. That is a shortcut, not a shared cache: the moment one branch bumps a version, both branches run whatever the main checkout installed last, and the failure that follows looks like a bug in your code rather than in your setup. When in doubt, install.

A package manager with a real content-addressed store — pnpm, or Yarn with PnP — already makes the second install cheap, which is usually the better answer than linking.

## Large directories that are expensive to rebuild

**The situation.** A `fixtures/` directory of sample media, a model checkpoint, a downloaded dataset. Git ignores it, it never differs between branches, and copying it to every worktree wastes a gigabyte each time.

**The configuration.**

```toml
symlink = ["fixtures", ".cache/models"]
```

**What to watch.** This is what `symlink` is for: read-mostly, branch-independent, and expensive. A worktree that writes into a linked directory writes into the main checkout, so anything a test run mutates belongs in `copy` instead.

On Windows, directory links are junctions and need no special privileges. A *file* link does need Developer Mode; when Windows refuses one, the plugin copies the file and says so in the log.

## A Rails application

**The situation.** A new worktree has `config/credentials.yml.enc` from git but not `config/master.key`, so the first boot fails to decrypt anything.

**The configuration.** None. `config/master.key` and `config/credentials/*.key` are probed directly, precisely because `.gitignore` usually excludes the whole `config/credentials/` directory and git then reports the directory rather than the keys inside it.

**What to watch.** If your keys live somewhere else, name them yourself — detection and an explicit list add up rather than replacing each other:

```toml
copy = ["config/credentials/staging.key"]
```

## Terraform, where one `.tfvars` is not like the others

**The situation.** `dev.tfvars` belongs in every worktree. `prod.tfvars` holds credentials you would rather not scatter across a dozen checkouts.

**The configuration.**

```toml
exclude = ["**/prod.tfvars"]
```

**What to watch.** `exclude` trims what detection found; it does not veto an explicit `copy` entry. If you want a strict allowlist instead of a filtered denylist, turn detection off and say exactly what you mean:

```toml
auto_detect = false
copy = ["envs/dev.tfvars"]
```

## When `.env.example` holds working defaults

**The situation.** Your `.env.example` is not a form to fill in — it points at a local Postgres on the default port and works as-is.

**The configuration.**

```toml
seed_from_example = true
```

**What to watch.** It is off by default for a reason. A `.env` full of `replace-me` placeholders starts the application and then misbehaves somewhere deep, while a missing `.env` fails immediately and names the problem. Turn it on only where the example genuinely runs.

Seeding never overwrites: a real `.env` copied from the main checkout is already in place by then, and the placeholder is skipped.

## Setup commands on Windows

**The situation.** Your `post_create` block was written on macOS and does nothing but fail on a colleague's Windows machine.

**The configuration.**

```toml
post_create = ["pnpm install", "pnpm build"]
```

**What to watch.** Commands run through PowerShell, not `cmd.exe`. `&&` is a syntax error in Windows PowerShell 5.1, so `"pnpm install && pnpm build"` has to become two entries — which costs nothing, since the run already stops at the first failure. `set`, `copy` and `del` are `cmd` built-ins and are gone; PowerShell has its own.

## Checking your work

Every recipe above is worth previewing before you rely on it:

```bash
herdr plugin action invoke lamngockhuong.worktree-setup.dry-run
```

The preview renders each command exactly as the shell will receive it, quoting included, which is the fastest way to see what a template resolved to. After a real run, the log has one line per file with the reason for every skip:

```bash
herdr plugin log list --plugin lamngockhuong.worktree-setup --limit 20
```

If a `post_create` block was skipped entirely, the repository is not trusted yet; the log prints the exact line to add. See [Setup commands and trust](../README.md#setup-commands-and-trust).
