import { spawnSync } from "node:child_process";

/**
 * Run git in `cwd` and return trimmed stdout. Throws with git's own stderr when
 * the command fails, so callers surface the real reason instead of an empty
 * string.
 */
export function git(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || "").trim() || `exit code ${result.status}`;
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout.trim();
}

/** Absolute path of the repository's main worktree, seen from any linked one. */
export function mainWorktree(cwd) {
  const porcelain = git(cwd, ["worktree", "list", "--porcelain"]);
  const first = porcelain.split(/\r?\n/).find((line) => line.startsWith("worktree "));
  if (!first) throw new Error(`no main worktree found from ${cwd}`);
  return first.slice("worktree ".length);
}

/**
 * Paths git does not track: untracked and ignored entries, with wholly ignored
 * directories collapsed to a single trailing-slash entry.
 */
export function ignoredEntries(repoRoot) {
  const stdout = git(repoRoot, [
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
  ]);
  return stdout.split(/\r?\n/).filter(Boolean);
}

/** Paths git has under version control, relative to the repository root. */
export function trackedFiles(repoRoot) {
  return git(repoRoot, ["ls-files"]).split(/\r?\n/).filter(Boolean);
}

/** Whether git ignores `relativePath`, used to vet paths found on disk. */
export function isIgnored(repoRoot, relativePath) {
  const result = spawnSync("git", ["check-ignore", "-q", "--", relativePath], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0;
}
