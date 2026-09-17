#!/usr/bin/env node
// The `dry-run` action in two halves: invoked as an action it opens a Herdr
// pane, and that pane runs the preview. Herdr captures an action's stdout into
// the plugin log and displays it nowhere, so a preview the action prints itself
// is a preview nobody reads.

import { pathToFileURL } from "node:url";
import { herdrCli } from "./herdr.mjs";
import { runCli } from "./index.mjs";

// Both name entries in herdr-plugin.toml; a test holds them to it.
export const PLUGIN_ID = "lamngockhuong.worktree-setup";
export const ENTRYPOINT_ID = "preview";

// How the CLI says the pane is up: a plugin pane reports itself, while a popup
// — a session resource rather than a pane, with no id to report — answers `ok`.
const OPENED = new Set(["plugin_pane_opened", "ok"]);

/**
 * Read what the CLI answered: null once the pane is up, or the reason it is
 * not. Separate from the call so a test can pin the answers it understands.
 */
export function paneFailure(result) {
  if (result.error) return result.error.message;

  // Every answer is JSON, and a refusal the CLI understood — `ui_busy` while
  // another Herdr modal holds the screen — arrives there, not in the exit code.
  try {
    const answer = JSON.parse(result.stdout);
    if (!answer.error && OPENED.has(answer.result?.type)) return null;
  } catch {
    // Not JSON at all, so the raw text below is the best reason there is.
  }

  return (result.stdout || result.stderr || `exit ${result.status}`).trim();
}

/**
 * Ask Herdr to open the pane that renders the preview. Where it opens is the
 * manifest's business rather than this file's, so no placement is requested.
 */
function openPane(env) {
  return paneFailure(
    herdrCli(
      ["plugin", "pane", "open", "--plugin", PLUGIN_ID, "--entrypoint", ENTRYPOINT_ID, "--focus"],
      env,
    ),
  );
}

/**
 * Hold the pane open. A pane closes when its command exits, and a preview that
 * disappears in the frame it was drawn is the problem this file exists to fix.
 * Outside a terminal there is nobody to press the key, so it returns at once.
 */
async function waitForKey() {
  const { stdin } = process;
  if (!stdin.isTTY) return;

  console.log("\npress any key to close");
  stdin.setRawMode(true);
  stdin.resume();

  await new Promise((resolve) => stdin.once("data", resolve));

  stdin.setRawMode(false);
  stdin.pause();
}

export async function main(env = process.env, argv = []) {
  if (argv.includes("--pane")) {
    const code = runCli(env, ["--dry-run"]);
    await waitForKey();
    return code;
  }

  const failure = openPane(env);
  if (!failure) return 0;

  // No pane to read, so fall back to the plugin log: printing here is what this
  // action did before, and the reason it had to belongs next to the output.
  console.error(`could not open the preview pane: ${failure}`);
  return runCli(env, ["--dry-run"]);
}

// Only act when Herdr invokes the file; importing it in tests must stay inert.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.env, process.argv.slice(2));
}
