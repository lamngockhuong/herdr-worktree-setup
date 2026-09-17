import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const created = [];

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

/** Add a linked worktree and return its path. */
export function addWorktree(repoRoot, branch = "feature") {
  const path = realpathSync.native(join(repoRoot, ".."));
  // A branch name may hold `/`, which would make the directory a nested path.
  const target = join(path, `${branch.replaceAll("/", "-")}-${Date.now()}`);
  run(repoRoot, ["worktree", "add", "-q", "-b", branch, target]);
  created.push(target);
  return target;
}

/** Plugin environment as Herdr would set it for a worktree.created hook. */
export function pluginEnv(repoRoot, worktreePath, extra = {}, branch = "feature") {
  return {
    HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({
      worktree: { checkout_path: worktreePath, repo_root: repoRoot, branch },
    }),
    HERDR_BIN_PATH: join(repoRoot, "no-such-herdr-binary"),
    ...extra,
  };
}

export function cleanup() {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
}
