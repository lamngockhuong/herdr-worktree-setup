#!/usr/bin/env node
// Entry point for Herdr's `worktree.created` event hook, and for `--dry-run`.

import { pathToFileURL } from "node:url";
import { copyEntry, exampleSeeds, seedFromExamples, symlinkEntry } from "./apply.mjs";
import { CONFIG_FILENAME, loadConfig } from "./config.mjs";
import { contextCwd, readContext } from "./context.mjs";
import { detectFiles } from "./detect.mjs";
import { currentBranch, mainWorktree, worktreeRoot } from "./git.mjs";
import { runPostCreate, TRUST_FILENAME, trustedForCommands } from "./post-create.mjs";
import { notify, printReport, summarize, summaryLine } from "./report.mjs";
import { render, worktreeVariables } from "./template.mjs";

function collectCopyTargets(repoRoot, config) {
  const detected = config.auto_detect
    ? detectFiles(repoRoot, { patterns: config.patterns, exclude: config.exclude })
    : [];

  // Explicit entries win over the exclude list: naming a path is a deliberate
  // choice, while excludes exist to trim what auto-detection guessed.
  return [...new Set([...detected, ...config.copy])];
}

/**
 * Where `--dry-run` looks when no event is being delivered: an explicit path
 * argument, then the worktree or workspace Herdr says is in focus, then the
 * current directory — the order `src/init.mjs` resolves a repository in.
 */
function resolveDryRunTarget(env = process.env, argv = []) {
  const explicit = argv.find((argument) => !argument.startsWith("-"));

  if (!explicit) {
    try {
      return readContext(env);
    } catch {
      // No worktree in either blob, which is the normal case for an action
      // invoked from a workspace. The cwd below answers it instead.
    }
  }

  const worktreePath = worktreeRoot(explicit ?? contextCwd(env));

  return {
    worktreePath,
    repoRoot: mainWorktree(worktreePath),
    branch: currentBranch(worktreePath),
  };
}

const preview = (verb, path, detail) =>
  console.log(`would ${verb.padEnd(4)} ${path}${detail ? ` — ${detail}` : ""}`);

/**
 * Print the run instead of performing it. Commands appear rendered and escaped
 * exactly as they would reach the shell; the copy, link and seed lines are the
 * targets as they were resolved, not a promise that each one would succeed.
 */
function dryRun({ worktreePath, repoRoot }, config, vars, env) {
  console.log("dry run: nothing is linked, copied, seeded or executed");

  for (const relative of config.symlink) preview("link", relative);
  for (const relative of collectCopyTargets(repoRoot, config)) preview("copy", relative);

  if (config.seed_from_example) {
    for (const seed of exampleSeeds(worktreePath, config.patterns)) {
      preview("seed", seed.target, `from ${seed.source}`);
    }
  }

  if (
    config.post_create.length > 0 &&
    !trustedForCommands(repoRoot, env.HERDR_PLUGIN_CONFIG_DIR, env)
  ) {
    // Said before the commands, so the lines below read as what they resolve
    // to rather than as a promise that any of them would run.
    console.log(
      `the commands below are shown rendered but would be skipped: ${repoRoot} ` +
        `is not listed in ${TRUST_FILENAME}`,
    );
  }

  for (const command of config.post_create) {
    try {
      preview("run", render(command, vars));
    } catch (error) {
      // The real run stops the sequence at a render failure, so say so here too.
      preview("fail", command, error.message);
      return 1;
    }
  }

  return 0;
}

export function run(env = process.env, argv = []) {
  const dry = argv.includes("--dry-run");
  const { worktreePath, repoRoot, branch } = dry
    ? resolveDryRunTarget(env, argv)
    : readContext(env);
  const config = loadConfig(repoRoot);

  console.log(`worktree ${worktreePath}`);
  console.log(`repository ${repoRoot}${branch ? ` (${branch})` : ""}`);
  console.log(config.configured ? `config ${CONFIG_FILENAME}` : "config defaults");

  const vars = worktreeVariables({ worktreePath, repoRoot, branch });
  if (dry) return dryRun({ worktreePath, repoRoot }, config, vars, env);

  const results = [];

  // Links go in before copies. Copying first would create the parent directories
  // of every detected file, and a directory the user asked to link would then
  // already exist by the time its turn came, so the link was quietly dropped.
  for (const relative of config.symlink) {
    results.push(symlinkEntry(repoRoot, worktreePath, relative));
  }

  for (const relative of collectCopyTargets(repoRoot, config)) {
    results.push(copyEntry(repoRoot, worktreePath, relative));
  }

  if (config.seed_from_example) {
    results.push(...seedFromExamples(worktreePath, config.patterns));
  }

  results.push(
    ...runPostCreate(worktreePath, config.post_create, {
      timeoutMs: config.post_create_timeout_ms,
      configDir: env.HERDR_PLUGIN_CONFIG_DIR,
      repoRoot,
      env,
      vars,
    }),
  );

  printReport(results);

  const summary = summarize(results);
  const line = summaryLine(summary);
  console.log(line);

  if (config.notify) {
    const title = summary.failed > 0 ? "Worktree setup incomplete" : "Worktree ready";
    notify(title, branch ? `${branch}: ${line}` : line, env);
  }

  return summary.failed > 0 ? 1 : 0;
}

/** `run` with the failure report every caller outside the tests owes the log. */
export function runCli(env = process.env, argv = []) {
  try {
    return run(env, argv);
  } catch (error) {
    console.error(`worktree setup failed: ${error.message}`);
    return 1;
  }
}

// Only act when Herdr invokes the file; importing it in tests must stay inert.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCli(process.env, process.argv.slice(2));
}
