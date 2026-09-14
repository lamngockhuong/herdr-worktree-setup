import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  const root = mkdtempSync(join(tmpdir(), "herdr-wt-"));
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
  const path = join(repoRoot, "..", `${branch}-${Date.now()}`);
  run(repoRoot, ["worktree", "add", "-q", "-b", branch, path]);
  created.push(path);
  return path;
}

/** Plugin environment as Herdr would set it for a worktree.created hook. */
export function pluginEnv(repoRoot, worktreePath, extra = {}) {
  return {
    HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({
      worktree: { checkout_path: worktreePath, repo_root: repoRoot, branch: "feature" },
    }),
    HERDR_BIN_PATH: join(repoRoot, "no-such-herdr-binary"),
    ...extra,
  };
}

export function cleanup() {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
}
