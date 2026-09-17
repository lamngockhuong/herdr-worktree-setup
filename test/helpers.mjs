import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { TRUST_FILENAME } from "../src/commands.mjs";

const created = [];

// Test files run in parallel processes against one shared temp directory, so a
// fixture name built from the clock alone collides whenever two files ask for
// the same branch in the same millisecond. `makeRepo` already owns a name no
// other process can hold, so naming fixtures after their repository settles it.
let fixtureCount = 0;

function run(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

/** Write a file, creating whatever directories it needs. */
export function write(root, relative, contents) {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return target;
}

/** A throwaway git repository with one commit, cleaned up after the suite. */
export function makeRepo(files = {}, { gitignore = "" } = {}) {
  // git reports the real path, so the fixture must not hand back a symlinked
  // or 8.3 short one, or every path comparison in the suite disagrees.
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "herdr-wt-")));
  created.push(root);

  run(root, ["init", "-q", "-b", "main"]);
  run(root, ["config", "user.email", "test@example.com"]);
  run(root, ["config", "user.name", "Test"]);
  run(root, ["config", "commit.gpgsign", "false"]);

  write(root, ".gitignore", gitignore);
  for (const [relative, contents] of Object.entries(files)) write(root, relative, contents);

  run(root, ["add", "-A"]);
  run(root, ["commit", "-qm", "initial"]);
  return root;
}

/**
 * Add a linked worktree and return its path. A `null` branch checks out a
 * detached HEAD, which is the one state `{{ branch }}` cannot fill — the same
 * spelling the payload fixtures use for "no branch".
 */
export function addWorktree(repoRoot, branch = "feature") {
  // A branch name may hold `/`, which would make the directory a nested path.
  const name = `${basename(repoRoot)}-${branch?.replaceAll("/", "-") ?? "detached"}-${fixtureCount++}`;
  const target = join(realpathSync.native(join(repoRoot, "..")), name);
  run(repoRoot, ["worktree", "add", "-q", ...(branch ? ["-b", branch] : ["--detach"]), target]);
  created.push(target);
  return target;
}

/**
 * A plugin config directory, holding a trust list naming `trustedRepo` when one
 * is given. Registered for cleanup like every other fixture, which an inline
 * `mkdtempSync` in a test file is not.
 */
export function configDir(trustedRepo) {
  const dir = mkdtempSync(join(tmpdir(), "herdr-wt-cfg-"));
  created.push(dir);
  if (trustedRepo) write(dir, TRUST_FILENAME, `# trusted\n${trustedRepo}\n`);
  return dir;
}

/** A script that records the argument it was handed, for asserting on later. */
export const writeArgScript = (target = "arg.txt") =>
  `require("node:fs").writeFileSync("${target}", process.argv[2] ?? "");`;

/** A repository whose `key` block runs one command and notifies nobody. */
export function repoRunningCommand(key, command, files = {}) {
  const repo = makeRepo({ "write-arg.cjs": writeArgScript(), ...files });
  write(repo, ".herdr-worktree.toml", `${key} = ["${command}"]\nnotify = false`);
  return repo;
}

/**
 * Plugin environment shaped like the one Herdr really sets, captured from a
 * live 0.9.1 server. Two details matter and both have bitten this plugin: the
 * invocation context names the checkout and the repository but carries no
 * branch, and the event payload nests everything one level below `data`. A
 * fixture that flattens either one tests a shape nothing sends.
 */
function eventEnv(type, repoRoot, worktreePath, branch, extra) {
  const worktree = {
    repo_name: basename(repoRoot),
    repo_root: repoRoot,
    checkout_path: worktreePath,
    is_linked_worktree: true,
  };

  return {
    HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({
      workspace_id: "wA",
      workspace_cwd: worktreePath,
      worktree,
      correlation_id: type.replace("_", "."),
    }),
    HERDR_PLUGIN_EVENT_JSON: JSON.stringify({
      event: type,
      data: {
        type,
        workspace: { workspace_id: "wA", worktree },
        worktree: { path: worktreePath, branch, is_detached: branch === null },
      },
    }),
    HERDR_BIN_PATH: join(repoRoot, "no-such-herdr-binary"),
    ...extra,
  };
}

/** Plugin environment as Herdr sets it for a `worktree.created` hook. */
export function pluginEnv(repoRoot, worktreePath, extra = {}, branch = "feature") {
  return eventEnv("worktree_created", repoRoot, worktreePath, branch, extra);
}

/**
 * The same for `worktree.removed`, whose checkout is already gone by then.
 * Nothing in `src/` reads the event name, so this differs from `pluginEnv` only
 * in what it documents at the call site — which is reason enough to keep it.
 */
export function removedEnv(repoRoot, worktreePath, extra = {}, branch = "feature") {
  return eventEnv("worktree_removed", repoRoot, worktreePath, branch, extra);
}

/** Run one of the plugin's entry points the way Herdr runs it: as a child. */
export function runEntry(script, argv = [], env = {}) {
  return spawnSync(process.execPath, [join(import.meta.dirname, "..", script), ...argv], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

export function cleanup() {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
}
