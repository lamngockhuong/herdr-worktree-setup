# Herdr Worktree Setup

**English** · [Tiếng Việt](README.vi.md)

A [Herdr](https://herdr.dev) plugin that prepares every worktree Herdr creates.

`git worktree add` gives you a clean checkout of tracked files — and nothing else. The `.env` you spent an afternoon filling in stays behind in the main checkout, so the first thing a new worktree does is fail to boot. This plugin closes that gap on the `worktree.created` event.

It works with no configuration at all: it finds the config files git is ignoring and copies them across. A repository that wants more can say so in `.herdr-worktree.toml`.

Runs on Linux, macOS, and Windows. No dependencies beyond Node and git.

## Install

```bash
herdr plugin install lamngockhuong/herdr-worktree-setup
```

Requirements: Herdr 0.7.0+, git, and Node 22.5+ on the `PATH` of whatever process runs the Herdr server — not merely on your shell's. A server started at login by systemd or launchd usually has a narrower one; [Nothing ran at all](#nothing-ran-at-all) covers the symptom and the fix.

Nothing else to do. Create a worktree and watch the toast:

```bash
herdr worktree create --branch feature/checkout
```

## What it finds on its own

The plugin copies a file only when git ignores it **and** its name looks like per-checkout configuration. That pairing is the whole safety story: a build directory or a dependency tree is ignored but never matches a pattern, and a tracked file is already in the worktree.

| Pattern | Typical source |
| --- | --- |
| `**/.env`, `**/.env.*` | Node, Python, Rails, Docker Compose |
| `**/.envrc` | direnv |
| `**/.dev.vars`, `**/.dev.vars.*` | Cloudflare Workers |
| `**/.npmrc`, `**/.yarnrc.yml` | private registry tokens |
| `**/local.properties` | Android SDK paths |
| `**/*.tfvars`, `**/*.tfvars.json` | Terraform |
| `config/master.key`, `config/credentials/*.key` | Rails credentials |

Anything ending in `.example`, `.sample`, `.template`, `.dist`, or `.tpl` is skipped — those are committed placeholders, and the worktree already has them.

Two more rules worth knowing:

- **Nothing is ever overwritten.** A path that already exists in the new worktree is left exactly as it is.
- **Wholly ignored directories are not searched.** When `.gitignore` excludes `node_modules/`, git reports the directory, not its contents, and the plugin never walks inside. The Rails paths above are probed directly for exactly this reason.

## Configuration

Let the plugin write the file for you, from the workspace of the repository you want to configure:

```bash
herdr plugin action invoke lamngockhuong.worktree-setup.init-config
```

It drops a fully commented `.herdr-worktree.toml` at the repository root — every key documented, every one of them commented out, so creating the file changes nothing until you edit it. The header lists what detection finds in *your* repository right now, which is usually the fastest way to see whether you need any configuration at all:

```toml
# Detected in this repository right now:
#   apps/api/.env.local
#   apps/web/.env.local
#   apps/worker/.env.local
#   packages/database/.env.local
```

An existing config is never overwritten. Outside Herdr, `node src/init.mjs /path/to/repo` does the same thing.

Or write it by hand. Every key is optional.

```toml
# Turn the built-in detection off to copy only what you list below.
auto_detect = true

# Replace the built-in pattern list entirely.
patterns = ["**/.env.*", "**/secrets.yaml"]

# Always copy these, detected or not. Relative to the repository root.
copy = ["config/keystore.p12"]

# Link back to the main checkout instead of copying. Good for large directories.
symlink = ["node_modules"]

# Drop these from what detection found. Explicit `copy` entries are not affected.
exclude = ["**/.env.ci"]

# Create a missing `.env` from a committed `.env.example`. Off by default.
seed_from_example = false

# Commands to run in the new worktree. Requires trust — see below.
post_create = ["pnpm install", "pnpm dev --port {{ branch | hash_port }}"]
post_create_timeout_ms = 600000

# Show a Herdr toast when the run finishes.
notify = true
```

| Key | Type | Default |
| --- | --- | --- |
| `auto_detect` | boolean | `true` |
| `patterns` | string list | the table above |
| `copy` | string list | `[]` |
| `symlink` | string list | `[]` |
| `exclude` | string list | `[]` |
| `seed_from_example` | boolean | `false` |
| `post_create` | string list | `[]` |
| `post_create_timeout_ms` | integer | `600000` |
| `notify` | boolean | `true` |

A misspelled key is an error, not a shrug: the plugin names it and lists the valid ones. `copy` and `symlink` entries must stay inside the repository — absolute paths and `..` are rejected.

The file reads a deliberately small slice of TOML: comments, `key = value`, and one level of `[section]` headers, where a value is a boolean, an integer, a string, or a list of those. Anything else fails loudly rather than parsing into silence.

### `seed_from_example`

Off by default, and that is a judgment call worth explaining. A `.env` full of `replace-me` placeholders starts the app and then misbehaves somewhere deep; a missing `.env` fails immediately and tells you what is wrong. Turn it on for repositories where the example file holds working local defaults.

## Setup commands and trust

`post_create` runs commands the *repository* chose. Cloning someone's project and opening a worktree must never be enough to execute them, so the machine's owner opts each repository in, from outside the repository:

```bash
herdr plugin config-dir lamngockhuong.worktree-setup
# append the repository's absolute path to trusted-repos.txt in that directory
```

One absolute path per line; `#` starts a comment. Until a repository appears there, its `post_create` block is skipped and the log prints the exact line to add.

`HERDR_WORKTREE_SETUP_TRUST_ALL=1` disables the gate entirely. Set it only if every repository you open is one you wrote.

Commands run in the new worktree, stopping at the first failure. The shell is `/bin/sh` on Linux and macOS, and **PowerShell** on Windows — `powershell.exe -NoProfile -NonInteractive`, not `cmd.exe`. Your PowerShell profile is deliberately not loaded, so a hook sees the same environment whoever runs it.

Windows users upgrading from 0.1.0 should re-read their `post_create` block, because the shell changed under it:

- `&&` and `||` are syntax errors in Windows PowerShell 5.1. Split `"pnpm i && pnpm build"` into two entries — they already stop at the first failure.
- `cmd` built-ins such as `set`, `copy` and `del` are gone. PowerShell has its own.
- A failed command is reported as `exit code 1` whatever it actually exited with. PowerShell only forwards its own exit status unless the command string ends in `exit $LASTEXITCODE`, and appending that would report a *success* wrongly when the last thing to run was a cmdlet. The failure is detected either way; only the number is lost.

## Template variables

Every `post_create` entry may carry `{{ variable }}` placeholders, which is what lets two worktrees of the same repository run side by side instead of fighting over one port or one container name:

```toml
post_create = [
  "pnpm install",
  "docker compose -p {{ repo_name }}-{{ branch | sanitize }} up -d",
  "pnpm dev --port {{ branch | hash_port }}",
]
```

| Variable | Value |
| --- | --- |
| `branch` | the branch checked out in the new worktree |
| `worktree_path` | the new checkout's absolute path |
| `worktree_name` | its last path segment |
| `repo_path` | the main checkout's absolute path |
| `repo_name` | its last path segment |

One optional filter per placeholder, written after a `|`:

| Filter | Does | `feature/checkout` becomes |
| --- | --- | --- |
| `sanitize` | replaces `/` and `\` with `-` | `feature-checkout` |
| `hash` | three base36 characters of a digest | `l22` |
| `hash_port` | a port in 10000–19999 | `13706` |

`hash` and `hash_port` are pure functions of the branch name, so a branch claims the same port on every run, and two branches claim different ones. Those numbers are a compatibility surface: changing how they are computed would move every existing worktree's port, so it is treated as a breaking change rather than a fix.

Three rules worth knowing:

- **Substituted values are shell-quoted.** `--port {{ branch | hash_port }}` reaches the shell as `--port '13706'`. Harmless for anything reading argv, but a command doing its own string surgery on what it receives will see the quotes. The quoting is what stops a branch named `a;rm -rf ~` from being an instruction: git accepts that name, and the plugin runs it as one literal argument on every platform. The surrounding command text is yours and is left exactly as written.
- **Nothing renders as empty.** An unknown variable name, a misspelled filter, and a `{{` with no `}}` each fail the command and name the problem. So does `{{ branch }}` in a detached worktree, which has no branch: a command built from a silently missing port is worse than one that refuses to run.
- **Do not put your own quotes around a placeholder.** `--name "{{ branch | sanitize }}"` gives the command `"'feature-a'"`, quotes and all. The plugin has already quoted it.
- **Another tool's braces are left alone.** Only an expression shaped like a variable name, such as `{{ branch }}` or `{{ branch | hash_port }}`, is claimed. `docker ps --format '{{.Names}}'` and a Go or Helm template pass through exactly as written.
- **Only commands are templated.** `copy`, `symlink`, `patterns` and `exclude` stay literal, so a bad path is caught when the config is read rather than mid-run.

## Seeing what would happen

```bash
herdr plugin action invoke lamngockhuong.worktree-setup.dry-run
```

The action opens a pane over the workspace and prints the run there without performing it — nothing is linked, copied, seeded or executed:

```
worktree /path/to/worktree
repository /path/to/repo (feature/checkout)
config .herdr-worktree.toml
dry run: nothing is linked, copied, seeded or executed
would link shared
would copy apps/api/.env.local
would run  pnpm dev --port '13706'

press any key to close
```

The pane is the point. Herdr captures the stdout of a plugin action into the command log and displays it nowhere, so a preview the action printed itself would be a preview nobody reads. The pane closes on the next key you press. When Herdr will not open one — another modal is already up — the action says so and falls back to printing the preview into the log, where `herdr plugin log list` finds it.

Commands appear rendered and quoted exactly as they would reach the shell, which is the fastest way to see what a template resolves to. The copy, link and seed lines are the targets as they were resolved, not a promise that each one would succeed. A template that cannot be rendered is reported and exits non-zero.

Outside Herdr, `node src/index.mjs --dry-run /path/to/worktree` does the same; with no path it uses the workspace Herdr has in focus, or the current directory.

## Copy or link?

Copy for anything that may diverge between branches — every `.env` qualifies.

Link for large directories that are expensive to rebuild. Be careful with dependency trees: a linked `node_modules` means the worktree runs the *main* checkout's dependencies, so two branches with different lockfiles will fight over one tree. Prefer `post_create = ["pnpm install"]` when branches change dependencies, and reach for `symlink` when they do not.

On Windows, directory links are created as junctions, which need no special privileges. File links do need Developer Mode or an elevated shell; when Windows refuses one, the plugin copies the file instead and says so in the log.

## When something looks wrong

Every run writes a full report — one line per file, with the reason for each skip:

```bash
herdr plugin log list --plugin lamngockhuong.worktree-setup --limit 20
```

### Nothing ran at all

A failed entry with no output of its own is not the plugin reporting a problem — it is the plugin never having started:

```json
{"command":["node","src/index.mjs"],"error":"No such file or directory (os error 2)",
 "event":"worktree.created","status":"failed"}
```

The missing file is `node`. Herdr runs plugin commands with the environment of the *server* process, and a server launched at login by systemd or launchd inherits a minimal `PATH` instead of your shell's. Volta, nvm, fnm, and asdf all install node outside that `PATH`, so the hook dies before one line of it runs. Nothing surfaces in the UI: no toast, no error, just a worktree missing its config files. The plugin log is the only place it shows.

Compare what each side sees:

```bash
which node                                                   # your shell
systemctl --user show -p Environment homebrew.herdr.service  # the server
```

On Linux, hand the unit a usable `PATH` — substitute your own unit name, which a Homebrew install spells `homebrew.herdr.service`:

```bash
mkdir -p ~/.config/systemd/user/homebrew.herdr.service.d
cat > ~/.config/systemd/user/homebrew.herdr.service.d/path.conf <<EOF
[Service]
Environment=PATH=$(dirname "$(command -v node)"):/usr/local/bin:/usr/bin:/bin
EOF
systemctl --user daemon-reload
systemctl --user restart homebrew.herdr.service
```

On macOS, set the same variable on the launch agent — an `EnvironmentVariables` dictionary holding `PATH` in its plist, or `launchctl setenv PATH ...` before the agent starts.

You can also run the hook by hand against any checkout:

```bash
HERDR_PLUGIN_CONTEXT_JSON='{"worktree":{"checkout_path":"/path/to/worktree","repo_root":"/path/to/repo"}}' \
  node src/index.mjs
```

## Development

```bash
git clone https://github.com/lamngockhuong/herdr-worktree-setup.git
cd herdr-worktree-setup
pnpm test         # node:test, builds real repositories in a temp directory
pnpm lint
herdr plugin link .
```

## License

MIT © Lam Ngoc Khuong
