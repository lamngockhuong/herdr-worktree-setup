import { globSync } from "node:fs";
import { matchesGlob } from "node:path";
import { ignoredEntries, isIgnored } from "./git.mjs";

// Files that hold per-checkout configuration and that git is told to ignore.
// Only paths matching one of these AND ignored by git are ever picked up, so a
// build directory or a dependency tree can never wander in.
export const DEFAULT_PATTERNS = [
  "**/.env",
  "**/.env.*",
  "**/.envrc",
  "**/.dev.vars",
  "**/.dev.vars.*",
  "**/.npmrc",
  "**/.yarnrc.yml",
  "**/local.properties",
  "**/*.tfvars",
  "**/*.tfvars.json",
];

// Suffixes that mark a committed placeholder rather than real configuration.
export const EXAMPLE_SUFFIXES = [".example", ".sample", ".template", ".dist", ".tpl"];

// `git ls-files --directory` collapses a wholly ignored directory into one
// entry, which hides real config nested inside it. These few well known paths
// are probed on disk instead, then vetted against git's ignore rules.
export const NESTED_PROBES = ["config/master.key", "config/credentials/*.key"];

const toPosix = (value) => value.replaceAll("\\", "/");

/** Whether a path is a committed placeholder such as `.env.example`. */
export function isExample(relativePath) {
  const lower = toPosix(relativePath).toLowerCase();
  return EXAMPLE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/** Whether any glob in `patterns` matches `relativePath`. */
export function matchesAny(relativePath, patterns) {
  const posix = toPosix(relativePath);
  return patterns.some((pattern) => matchesGlob(posix, pattern));
}

/**
 * Config-shaped, git-ignored files in the main worktree, as repo-relative POSIX
 * paths. `patterns` and `exclude` override and trim the defaults.
 */
export function detectFiles(repoRoot, { patterns = DEFAULT_PATTERNS, exclude = [] } = {}) {
  const found = new Set();

  for (const entry of ignoredEntries(repoRoot)) {
    // A trailing slash means git collapsed an entire ignored directory.
    if (entry.endsWith("/")) continue;
    if (isExample(entry)) continue;
    if (matchesAny(entry, patterns)) found.add(toPosix(entry));
  }

  for (const probe of NESTED_PROBES) {
    let hits;
    try {
      hits = globSync(probe, { cwd: repoRoot });
    } catch {
      continue;
    }
    for (const hit of hits) {
      const relative = toPosix(hit);
      if (isExample(relative)) continue;
      if (isIgnored(repoRoot, relative)) found.add(relative);
    }
  }

  const kept = [...found].filter((relative) => !matchesAny(relative, exclude));
  return kept.sort();
}
