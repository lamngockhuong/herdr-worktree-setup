#!/usr/bin/env node
// Entry point for Herdr's `worktree.removed` event hook.

import { pathToFileURL } from "node:url";
import { runCommands } from "./commands.mjs";
import { loadConfig } from "./config.mjs";
import { readContext } from "./context.mjs";
import { cleanupToast, notify, printReport, summarize, summaryLine } from "./report.mjs";
import { worktreeVariables } from "./template.mjs";

/**
 * Run the repository's `post_remove` block after Herdr deletes a worktree.
 *
 * Whatever `post_create` started outside the checkout — a Compose project, a
 * container, a volume — outlives the directory, because removing a worktree
 * only removes files. This is where a repository gets to clean up after
 * itself.
 */
export function run(env = process.env) {
  const { worktreePath, repoRoot, branch } = readContext(env);
  const config = loadConfig(repoRoot);

  // The common case by far: no teardown configured. Say nothing rather than
  // filling the log with a report about a repository that asked for none.
  if (config.post_remove.length === 0) return 0;

  console.log(`worktree ${worktreePath} (removed)`);
  console.log(`repository ${repoRoot}${branch ? ` (${branch})` : ""}`);

  const vars = worktreeVariables({ worktreePath, repoRoot, branch });

  // The checkout is already gone when this event fires, so commands run in the
  // repository. Anything they need to name — a Compose project, a container —
  // they name through the same variables that created it.
  const results = runCommands(repoRoot, config.post_remove, {
    timeoutMs: config.post_remove_timeout_ms,
    configDir: env.HERDR_PLUGIN_CONFIG_DIR,
    repoRoot,
    env,
    vars,
    action: "post_remove",
  });

  printReport(results);

  const summary = summarize(results);
  const line = summaryLine(summary);
  console.log(line);

  const toast = config.notify ? cleanupToast(summary, line, branch) : null;
  if (toast) notify(toast.title, toast.body, env);

  return summary.failed > 0 ? 1 : 0;
}

/** `run` with the failure report every caller outside the tests owes the log. */
export function runCli(env = process.env) {
  try {
    return run(env);
  } catch (error) {
    console.error(`worktree cleanup failed: ${error.message}`);
    return 1;
  }
}

// Only act when Herdr invokes the file; importing it in tests must stay inert.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCli(process.env);
}
