import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

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
  // git prints forward slashes even on Windows; give callers the native form.
  return resolve(first.slice("worktree ".length));
}

/**
 * Run an `ls-files` query with -z. Without it git escapes any path holding a
 * non-ASCII or unusual character and wraps the whole thing in quotes, and such
 * a name then matches no glob and drops out of every result unannounced.
 */
function listFiles(repoRoot, args) {
  return git(repoRoot, ["ls-files", "-z", ...args])
    .split("\0")
    .filter(Boolean);
}

/**
 * Paths git does not track: untracked and ignored entries, with wholly ignored
 * directories collapsed to a single trailing-slash entry.
 */
export function ignoredEntries(repoRoot) {
  return listFiles(repoRoot, ["--others", "--ignored", "--exclude-standard", "--directory"]);
}

/** Paths git has under version control, relative to the repository root. */
export function trackedFiles(repoRoot) {
  return listFiles(repoRoot, []);
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

/** Repository root for any path inside a checkout, resolved to the main one. */
export function repoRootFrom(cwd) {
  const toplevel = git(cwd, ["rev-parse", "--show-toplevel"]);
  return mainWorktree(toplevel);
}
