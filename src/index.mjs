#!/usr/bin/env node
// Entry point for Herdr's `worktree.created` event hook.

import { pathToFileURL } from "node:url";
import { copyEntry, seedFromExamples, symlinkEntry } from "./apply.mjs";
import { CONFIG_FILENAME, loadConfig } from "./config.mjs";
import { readContext } from "./context.mjs";
import { detectFiles } from "./detect.mjs";
import { runPostCreate } from "./post-create.mjs";
import { notify, printReport, summarize, summaryLine } from "./report.mjs";

function collectCopyTargets(repoRoot, config) {
  const detected = config.auto_detect
    ? detectFiles(repoRoot, { patterns: config.patterns, exclude: config.exclude })
    : [];

  // Explicit entries win over the exclude list: naming a path is a deliberate
  // choice, while excludes exist to trim what auto-detection guessed.
  const explicit = config.copy.map((entry) => entry.replaceAll("\\", "/"));
  return [...new Set([...detected, ...explicit])];
}

export function run(env = process.env) {
  const { worktreePath, repoRoot, branch } = readContext(env);
  const config = loadConfig(repoRoot);

  console.log(`worktree ${worktreePath}`);
  console.log(`repository ${repoRoot}${branch ? ` (${branch})` : ""}`);
  console.log(config.configured ? `config ${CONFIG_FILENAME}` : "config defaults");

  const results = [];

  // Links go in before copies. Copying first would create the parent directories
  // of every detected file, and a directory the user asked to link would then
  // already exist by the time its turn came, so the link was quietly dropped.
  for (const relative of config.symlink) {
    results.push(symlinkEntry(repoRoot, worktreePath, relative.replaceAll("\\", "/")));
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

// Only act when Herdr invokes the file; importing it in tests must stay inert.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = run();
  } catch (error) {
    console.error(`worktree setup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
