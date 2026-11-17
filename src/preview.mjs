#!/usr/bin/env node
// The `dry-run` action in two halves: invoked as an action it opens a Herdr
// pane, and that pane runs the preview. Herdr captures an action's stdout into
// the plugin log and displays it nowhere, so a preview the action prints itself
// is a preview nobody reads.

import { pathToFileURL } from "node:url";
import { addTrustLine, commandsVerdict, trustLine } from "./commands.mjs";
import { loadConfig } from "./config.mjs";
import { herdrCli } from "./herdr.mjs";
import { runCli } from "./index.mjs";
import { visible } from "./report.mjs";

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
 * Read one key in raw mode. The pane closes when its command exits, and a
 * preview that disappears in the frame it was drawn is the problem this file
 * exists to fix, so every path through the pane ends here.
 */
async function readKeyFromStdin() {
  const { stdin } = process;
  stdin.setRawMode(true);
  stdin.resume();

  const key = await new Promise((resolve) => stdin.once("data", resolve));

  stdin.setRawMode(false);
  stdin.pause();
  return key.toString();
}

/** The key that grants trust. Anything else, Ctrl+C and Escape included, closes. */
const TRUST_KEY = /^t$/i;

/**
 * Grant the trust the preview offered, for the commands it showed and no
 * others. The config is read again first: had a checkout or an edit changed
 * the commands since the preview was drawn, the hash on screen would no longer
 * describe them, and trusting the new ones would be trusting them unread.
 */
export function grantTrust(offer, env = process.env) {
  const now = commandsVerdict(offer.repoRoot, loadConfig(offer.repoRoot), offer.configDir, env);

  if (now.hash !== offer.hash) {
    return "not trusted: post_create or post_remove changed after this preview was drawn. Open the preview again to read them";
  }
  if (now.verdict === "trusted") return "already trusted, nothing written";

  const file = addTrustLine(offer.configDir, offer.repoRoot, offer.hash);
  return `trusted: added ${trustLine(offer.repoRoot, offer.hash)} to ${file}`;
}

/**
 * Hold the pane open, offering trust when the preview found commands the
 * repository is not trusted for. Outside a terminal there is nobody to press a
 * key, so it returns at once and never writes anything.
 */
export async function closePane(offer, env, { interactive, readKey }) {
  if (!interactive) return;

  // Without a config directory there is no list to write to: the pane is not
  // running under Herdr, and the printed line is the only way left.
  if (offer && offer.verdict !== "trusted" && offer.configDir) {
    console.log("\npress t to trust these commands for this repository, any other key to close");
    if (!TRUST_KEY.test(await readKey())) return;

    try {
      console.log(visible(grantTrust(offer, env)));
    } catch (error) {
      // A config broken between drawing and the key press, or a list that
      // cannot be written: nothing was trusted, and the pane must still close.
      console.log(visible(`not trusted: ${error.message}`));
    }
  }

  console.log("\npress any key to close");
  await readKey();
}

export async function main(env = process.env, argv = [], io = {}) {
  const { interactive = Boolean(process.stdin.isTTY), readKey = readKeyFromStdin } = io;

  if (argv.includes("--pane")) {
    const seen = {};
    const code = runCli(env, ["--dry-run"], seen);
    await closePane(seen.trust, env, { interactive, readKey });
    return code;
  }

  const failure = openPane(env);
  if (!failure) return 0;

  // No pane to read, so fall back to the plugin log: printing here is what this
  // action did before, and the reason it had to belongs next to the output.
  // Nobody can answer a prompt in the log, so trust is never offered there.
  console.error(`could not open the preview pane: ${failure}`);
  return runCli(env, ["--dry-run"]);
}

// Only act when Herdr invokes the file; importing it in tests must stay inert.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.env, process.argv.slice(2));
}
