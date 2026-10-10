import {
  cpSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  realpathSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative as relativePath, sep } from "node:path";
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

// The deepest part of `path` that exists, with every symlink in it resolved,
// or undefined when that part is a dangling link: it points somewhere that does
// not exist yet, so nothing can say where creating it would land. Components
// below a real directory do not exist, so none of them can be a link.
function realAncestor(path) {
  for (let current = path; ; current = dirname(current)) {
    try {
      return realpathSync(current);
    } catch (error) {
      if (error.code !== "ENOENT" || dirname(current) === current) throw error;
      if (pathExists(current)) return undefined;
    }
  }
}

function isWithin(path, root) {
  const rel = relativePath(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Why `path` would leave `root` through a symlinked directory, or undefined
 * when it stays inside. The config check only sees the spelling, and a
 * directory turned into a link escapes without a `..` in it. The last component
 * is left alone: a link there is reproduced as a link, never read through.
 */
function escapesThroughLink(path, root, side) {
  const real = realAncestor(dirname(path));
  if (real !== undefined && isWithin(real, realpathSync(root))) return undefined;
  return `refused: the ${side} path leaves ${root} through a symlinked directory`;
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
    // Checked before the parent is created, so a refused entry leaves no
    // directory behind outside the worktree either.
    const refusal =
      escapesThroughLink(source, repoRoot, "source") ??
      escapesThroughLink(target, worktreePath, "target");
    if (refusal) return result(action, relative, "failed", refusal);

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
 *
 * No containment check, unlike `placeEntry`: the source is tracked and the
 * target is its sibling, and git never checks a tracked file out beneath a
 * symlinked directory, so both already sit in a real directory of the worktree.
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
