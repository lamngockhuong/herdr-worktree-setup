#!/usr/bin/env node
// Herdr action: write a starter `.herdr-worktree.toml` into a repository.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CONFIG_FILENAME, DEFAULTS } from "./config.mjs";
import { contextCwd, pluginContext } from "./context.mjs";
import { detectFiles } from "./detect.mjs";
import { repoRootFrom } from "./git.mjs";

const HEADER = `# ${CONFIG_FILENAME}
# https://github.com/lamngockhuong/herdr-worktree-setup
#
# Every key is optional, and the plugin already copies the git-ignored config
# files it recognises without this file. Uncomment a key only to change that.`;

/**
 * Where to write the file: the worktree's repository if Herdr said so,
 * otherwise the repository containing the workspace or the focused pane.
 */
export function resolveRepoRoot(env = process.env, argv = []) {
  const explicit = argv[0];
  if (explicit) return repoRootFrom(explicit);

  const context = pluginContext(env);
  if (context?.worktree?.repo_root) return context.worktree.repo_root;

  return repoRootFrom(contextCwd(env));
}

/**
 * A starter file that documents every key and reports what detection finds in
 * this repository today, so the first read answers "what will it actually copy".
 */
export function renderTemplate(detected) {
  const found =
    detected.length > 0
      ? detected.map((file) => `#   ${file}`).join("\n")
      : "#   (nothing yet — no git-ignored config files matched)";

  return `${HEADER}
#
# Detected in this repository right now:
${found}

# Look for the config files listed above. Turn off to copy only what you name.
# auto_detect = true

# Replace the built-in pattern list entirely. The defaults cover .env files,
# .envrc, .npmrc, .dev.vars, local.properties, *.tfvars and Rails credentials.
# patterns = ["**/.env.*", "**/secrets.yaml"]

# Always copy these, detected or not. Relative to the repository root.
# copy = ["config/keystore.p12"]

# Link back to the main checkout instead of copying. Watch out for dependency
# trees: every worktree would then share one.
# symlink = ["shared/assets"]

# Drop these from what detection found. Explicit copy entries are unaffected.
# exclude = ["**/.env.ci"]

# Create a missing .env from a committed .env.example.
# seed_from_example = false

# Commands to run in the new worktree. The machine owner must trust this
# repository first: see the plugin README. An entry may carry {{ variable }}
# placeholders — branch, worktree_path, worktree_name, repo_path, repo_name —
# each optionally through one filter: sanitize, hash, or hash_port. Every
# substituted value is shell-quoted, so no branch name can run commands of its
# own, and a branch keeps the same port on every run.
# post_create = ["pnpm install", "docker compose -p {{ branch | sanitize }} up -d"]
# post_create_timeout_ms = ${DEFAULTS.post_create_timeout_ms}

# Show a Herdr toast when the run finishes.
# notify = true
`;
}

export function init(env = process.env, argv = []) {
  const repoRoot = resolveRepoRoot(env, argv);
  const target = join(repoRoot, CONFIG_FILENAME);
  const contents = renderTemplate(detectFiles(repoRoot));

  try {
    // Refuse to clobber: the existing file is someone's configuration.
    writeFileSync(target, contents, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    console.log(`${target} already exists, leaving it alone`);
    return 0;
  }

  console.log(`wrote ${target}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = init(process.env, process.argv.slice(2));
  } catch (error) {
    console.error(`could not write ${CONFIG_FILENAME}: ${error.message}`);
    process.exitCode = 1;
  }
}
