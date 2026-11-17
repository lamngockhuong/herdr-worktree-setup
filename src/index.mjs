#!/usr/bin/env node
// Entry point for Herdr's `worktree.created` event hook, and for `--dry-run`.

import { pathToFileURL } from "node:url";
import { copyEntry, exampleSeeds, seedFromExamples, symlinkEntry } from "./apply.mjs";
import { commandsVerdict, runCommands, untrustedDetail } from "./commands.mjs";
import { CONFIG_FILENAME, loadConfig } from "./config.mjs";
import { readContext, resolveTarget } from "./context.mjs";
import { detectFiles } from "./detect.mjs";
import {
  notify,
  printFailure,
  printReport,
  setupToast,
  shown,
  summarize,
  summaryLine,
  visible,
} from "./report.mjs";
import { render, worktreeVariables } from "./template.mjs";

function collectCopyTargets(repoRoot, config) {
  const detected = config.auto_detect
    ? detectFiles(repoRoot, { patterns: config.patterns, exclude: config.exclude })
    : [];

  // Explicit entries win over the exclude list: naming a path is a deliberate
  // choice, while excludes exist to trim what auto-detection guessed.
  return [...new Set([...detected, ...config.copy])];
}

// Every line of the dry run goes through here. Its output is the preview pane,
// where trust is granted, so nothing a repository put in a path, a command or
// an error message may reach the terminal as anything but drawn text.
const say = (line) => console.log(visible(line));

const preview = (verb, path, detail) =>
  say(`would ${verb.padEnd(4)} ${shown(path)}${detail ? ` — ${shown(detail)}` : ""}`);

const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Print the run instead of performing it. Commands appear rendered and escaped
 * exactly as they would reach the shell; the copy, link and seed lines are the
 * targets as they were resolved, not a promise that each one would succeed.
 *
 * The trust verdict it printed goes into `seen.trust`, hash included, so the
 * preview pane can grant trust for exactly the commands it listed, as written.
 */
function dryRun({ worktreePath, repoRoot }, config, vars, env, seen) {
  say("dry run: nothing is linked, copied, seeded or executed");

  for (const relative of config.symlink) preview("link", relative);
  for (const relative of collectCopyTargets(repoRoot, config)) preview("copy", relative);

  if (config.seed_from_example) {
    for (const seed of exampleSeeds(worktreePath, config.patterns)) {
      preview("seed", seed.target, `from ${seed.source}`);
    }
  }

  if (config.post_create.length > 0 || config.post_remove.length > 0) {
    // Said before the commands, so the lines below read as what they resolve
    // to rather than as a promise that any of them would run. A skip carries
    // the trust file in full and the line to add, because a preview that says
    // a repository is untrusted and leaves the reader to find out how to fix it
    // is a preview they have to follow up.
    const configDir = env.HERDR_PLUGIN_CONFIG_DIR;
    const { verdict, hash } = commandsVerdict(repoRoot, config, configDir, env);
    seen.trust = { repoRoot, configDir, verdict, hash };
    say(
      verdict === "trusted"
        ? `commands trusted (sha256:${hash})`
        : "the commands below are shown rendered but would be skipped: " +
            untrustedDetail(verdict, repoRoot, hash, configDir),
    );
  }

  // The real run stops the sequence at a render failure, so say so here too.
  // The commands after it are still listed, unrendered: the trust line covers
  // them, and a template that fails here may render on another checkout.
  let failed = false;
  for (const command of config.post_create) {
    if (failed) {
      preview("run", command, "not reached here: an earlier template failed, shown unrendered");
      continue;
    }
    try {
      preview("run", render(command, vars));
    } catch (error) {
      preview("fail", command, error.message);
      failed = true;
    }
  }

  // The trust line approves the teardown too, so the reader sees it here, even
  // after a setup template failed. Unrendered: by the time it runs the
  // variables may say something else.
  for (const command of config.post_remove) {
    preview("run", command, "on removal, shown unrendered");
  }

  // Last, so it lands right above the trust prompt: a reader who counts fewer
  // lines above than this knows the list has scrolled and is not complete.
  if (config.post_create.length > 0 || config.post_remove.length > 0) {
    say(
      `the trust line covers ${plural(config.post_create.length, "post_create command")} ` +
        `and ${plural(config.post_remove.length, "post_remove command")}, listed above`,
    );
  }

  return failed ? 1 : 0;
}

export function run(env = process.env, argv = [], seen = {}) {
  const dry = argv.includes("--dry-run");
  const { worktreePath, repoRoot, branch, branchSource, event } = dry
    ? resolveTarget(env, argv)
    : readContext(env);
  const config = loadConfig(repoRoot);

  say(`worktree ${worktreePath}`);
  say(`repository ${repoRoot}${branch ? ` (${branch})` : ""}`);

  // An event that names no branch is how a payload the plugin has stopped
  // understanding looks from in here: git covers for it silently while the
  // checkout exists, and `worktree.removed` then fails with nothing to go on.
  if (event && branchSource === "checkout") {
    say("note: the event named no branch, so it was read from the checkout instead");
  }
  say(config.configured ? `config ${CONFIG_FILENAME}` : "config defaults");

  const vars = worktreeVariables({ worktreePath, repoRoot, branch });
  if (dry) return dryRun({ worktreePath, repoRoot }, config, vars, env, seen);

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
    ...runCommands(worktreePath, config.post_create, {
      action: "post_create",
      timeoutMs: config.post_create_timeout_ms,
      configDir: env.HERDR_PLUGIN_CONFIG_DIR,
      repoRoot,
      config,
      env,
      vars,
    }),
  );

  printReport(results);

  const summary = summarize(results);
  const line = summaryLine(summary);
  console.log(line);

  if (config.notify) {
    const { title, body } = setupToast(summary, line, branch);
    notify(title, body, env);
  }

  return summary.failed > 0 ? 1 : 0;
}

/** `run` with the failure report every caller outside the tests owes the log. */
export function runCli(env = process.env, argv = [], seen = {}) {
  try {
    return run(env, argv, seen);
  } catch (error) {
    printFailure("worktree setup failed", error);
    return 1;
  }
}

// Only act when Herdr invokes the file; importing it in tests must stay inert.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCli(process.env, process.argv.slice(2));
}
