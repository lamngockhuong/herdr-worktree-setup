import { cpSync, lstatSync, mkdirSync, readlinkSync, statSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { exampleTarget, matchesAny } from "./detect.mjs";
import { trackedFiles } from "./git.mjs";
import { result } from "./report.mjs";

const IS_WINDOWS = process.platform === "win32";

// Deliberately lstat: a symlink whose destination is missing is still a path
// worth reproducing, and a target that already exists is left alone because the
// hook runs on a fresh checkout, so anything already there came from git.
function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

// Follows links on purpose: only Windows cares, and there a link to a directory
// needs a junction. A dangling link falls back to the file form.
function isDirectory(path) {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true });
}

// One unwritable file must not abandon everything after it. The failure lands
// in the report and the run ends non-zero, but the remaining entries still run.
function attempt(action, relative, work) {
  try {
    return work();
  } catch (error) {
    return result(action, relative, "failed", error.message);
  }
}

/**
 * Point `target` at `destination`. Windows refuses file symlinks without
 * Developer Mode, so a refused link degrades to a copy of `content` rather than
 * failing the run, and says so in the detail it returns.
 */
function writeLink(destination, target, content) {
  try {
    symlinkSync(destination, target, IS_WINDOWS && isDirectory(content) ? "junction" : "file");
    return undefined;
  } catch (error) {
    if (!IS_WINDOWS || (error.code !== "EPERM" && error.code !== "EACCES")) throw error;
    cpSync(content, target, { recursive: true, verbatimSymlinks: true });
    return "copied instead: Windows refused the link";
  }
}

/**
 * Put one repo-relative path into the new checkout. Every action that does so
 * answers the same two questions first, and `write` returns the detail line for
 * whatever it did.
 */
function placeEntry(action, repoRoot, worktreePath, relative, write) {
  const source = join(repoRoot, relative);
  const target = join(worktreePath, relative);

  if (!pathExists(source)) return result(action, relative, "skipped", "source is missing");
  if (pathExists(target)) return result(action, relative, "skipped", "already in the worktree");

  return attempt(action, relative, () => {
    ensureParent(target);
    return result(action, relative, "done", write(source, target));
  });
}

/** Copy one repo-relative path from the main worktree into the new checkout. */
export function copyEntry(repoRoot, worktreePath, relative) {
  return placeEntry("copy", repoRoot, worktreePath, relative, (source, target) => {
    // cpSync refuses a link whose destination does not exist, even with
    // verbatimSymlinks, so a link is rebuilt from what it points at instead.
    if (lstatSync(source).isSymbolicLink()) {
      return writeLink(readlinkSync(source), target, source);
    }
    cpSync(source, target, { recursive: true, verbatimSymlinks: true });
    return undefined;
  });
}

/** Link one repo-relative path back to the main worktree. */
export function symlinkEntry(repoRoot, worktreePath, relative) {
  return placeEntry("symlink", repoRoot, worktreePath, relative, (source, target) =>
    writeLink(source, target, source),
  );
}

/**
 * Every committed placeholder whose real counterpart is still missing, as
 * `{ source, target }` pairs. Split out from the copying so `--dry-run` can
 * name the same files without creating any of them.
 */
export function exampleSeeds(worktreePath, patterns) {
  const seeds = [];
  for (const tracked of trackedFiles(worktreePath)) {
    const target = exampleTarget(tracked);
    if (!target || !matchesAny(target, patterns)) continue;
    if (pathExists(join(worktreePath, target))) continue;

    seeds.push({ source: tracked, target });
  }
  return seeds;
}

/**
 * Fill gaps from committed placeholders: every tracked `*.example` whose real
 * counterpart is still missing gets a starting copy. Off by default, because a
 * file full of placeholder values can be worse than an obvious absence.
 */
export function seedFromExamples(worktreePath, patterns) {
  return exampleSeeds(worktreePath, patterns).map(({ source, target }) =>
    attempt("seed", target, () => {
      ensureParent(join(worktreePath, target));
      cpSync(join(worktreePath, source), join(worktreePath, target));
      return result("seed", target, "done", `from ${source}`);
    }),
  );
}
