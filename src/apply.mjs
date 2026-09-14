import { cpSync, existsSync, lstatSync, mkdirSync, statSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { EXAMPLE_SUFFIXES, isExample } from "./detect.mjs";
import { trackedFiles } from "./git.mjs";

const IS_WINDOWS = process.platform === "win32";

const result = (action, path, status, detail) => ({ action, path, status, detail });

// A target that already exists is left alone. The hook runs on a fresh
// checkout, so anything already there came from git and outranks a copy.
function targetExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true });
}

/** Copy one repo-relative path from the main worktree into the new checkout. */
export function copyEntry(repoRoot, worktreePath, relative) {
  const source = join(repoRoot, relative);
  const target = join(worktreePath, relative);

  if (!existsSync(source)) return result("copy", relative, "skipped", "source is missing");
  if (targetExists(target)) return result("copy", relative, "skipped", "already in the worktree");

  ensureParent(target);
  cpSync(source, target, { recursive: true, verbatimSymlinks: true });
  return result("copy", relative, "done");
}

/**
 * Link one repo-relative path back to the main worktree. Windows needs a
 * junction for directories and refuses file symlinks without Developer Mode, so
 * a refused link degrades to a copy rather than failing the run.
 */
export function symlinkEntry(repoRoot, worktreePath, relative) {
  const source = join(repoRoot, relative);
  const target = join(worktreePath, relative);

  if (!existsSync(source)) return result("symlink", relative, "skipped", "source is missing");
  if (targetExists(target)) {
    return result("symlink", relative, "skipped", "already in the worktree");
  }

  const isDirectory = statSync(source).isDirectory();
  ensureParent(target);

  try {
    symlinkSync(source, target, IS_WINDOWS && isDirectory ? "junction" : "file");
    return result("symlink", relative, "done");
  } catch (error) {
    if (!IS_WINDOWS || (error.code !== "EPERM" && error.code !== "EACCES")) throw error;
    cpSync(source, target, { recursive: true, verbatimSymlinks: true });
    return result("symlink", relative, "done", "copied instead: Windows refused the link");
  }
}

/** Strip a placeholder suffix, so `.env.local.example` becomes `.env.local`. */
export function exampleTarget(relative) {
  const lower = relative.toLowerCase();
  const suffix = EXAMPLE_SUFFIXES.find((candidate) => lower.endsWith(candidate));
  return suffix ? relative.slice(0, -suffix.length) : null;
}

/**
 * Fill gaps from committed placeholders: every tracked `*.example` whose real
 * counterpart is still missing gets a starting copy. Off by default, because a
 * file full of placeholder values can be worse than an obvious absence.
 */
export function seedFromExamples(worktreePath, { patterns, matchesAny }) {
  const results = [];
  for (const tracked of trackedFiles(worktreePath)) {
    if (!isExample(tracked)) continue;

    const target = exampleTarget(tracked);
    if (!target || !matchesAny(target, patterns)) continue;
    if (targetExists(join(worktreePath, target))) continue;

    ensureParent(join(worktreePath, target));
    cpSync(join(worktreePath, tracked), join(worktreePath, target));
    results.push(result("seed", target, "done", `from ${tracked}`));
  }
  return results;
}
