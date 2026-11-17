import { herdrCli } from "./herdr.mjs";

// The verb and the noun for each action, together: adding an action must not
// mean remembering a second table twenty lines further down.
const LABELS = {
  copy: ["copied", "file"],
  symlink: ["linked", "file"],
  seed: ["seeded", "file"],
  post_create: ["ran", "command"],
  post_remove: ["ran", "command"],
};

/**
 * One line of the report. Both `apply.mjs` and `commands.mjs` produce these,
 * and everything below reads them, so the shape is defined here. A record with
 * nothing to add carries no `detail` key at all rather than an empty one.
 */
export const result = (action, path, status, detail) =>
  detail === undefined ? { action, path, status } : { action, path, status, detail };

// The only thing that skips a whole command block is the trust gate, so a
// skipped command record means the block did not run at all. A skipped file is
// the plugin declining to overwrite, which is not worth reporting.
const COMMAND_ACTIONS = new Set(["post_create", "post_remove"]);

/**
 * Counts of what actually happened, keyed by action. Skipped files are
 * ignored; a command block the trust gate skipped is counted as `untrusted`.
 */
export function summarize(results) {
  const done = {};
  let failed = 0;
  let untrusted = 0;
  for (const item of results) {
    if (item.status === "failed") failed++;
    if (item.status === "skipped" && COMMAND_ACTIONS.has(item.action)) untrusted++;
    if (item.status !== "done") continue;
    done[item.action] = (done[item.action] ?? 0) + 1;
  }
  return { done, failed, untrusted };
}

/** One-line human summary, e.g. "copied 4 files, ran 1 command". */
export function summaryLine({ done, failed, untrusted }) {
  const parts = Object.entries(done).map(([action, count]) => {
    const [verb, unit] = LABELS[action] ?? [action, "file"];
    return `${verb} ${count} ${count === 1 ? unit : `${unit}s`}`;
  });
  if (failed > 0) parts.push(`${failed} failed`);
  if (untrusted > 0) parts.push("commands skipped: not trusted");
  return parts.length > 0 ? parts.join(", ") : "nothing to do";
}

// C0 controls, DEL, C1 controls, the line and paragraph separators, and the
// Unicode format characters (bidi overrides and isolates, zero-width spaces,
// the BOM): everything a terminal may act on, or reorder, instead of drawing.
// The preview is what trust is granted from, so a command must not be able to
// erase, overwrite or reverse its own line and show the reader something else.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
const UNDRAWN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Cf}]/gu;

const escapeChar = (char) => {
  const code = char.codePointAt(0);
  if (code <= 0xff) return `\\x${code.toString(16).padStart(2, "0")}`;
  return code <= 0xffff ? `\\u${code.toString(16).padStart(4, "0")}` : `\\u{${code.toString(16)}}`;
};

/** `text` with every character a terminal would not simply draw spelled out. */
export const visible = (text) => text.replace(UNDRAWN, escapeChar);

// How much of one command or path the preview prints, and how long a run of
// spaces may be before it is counted rather than drawn. Only U+0020 is
// counted: a newline or a tab means something to the shell, so every other
// whitespace character is spelled out by `visible` like any control. A pane wraps a long
// line, so without a bound one entry padded with spaces scrolls every line
// above it out of sight, and the reader grants trust for commands never seen.
const SHOWN_LIMIT = 160;
const LONG_SPACE = 4;
const PIECES = new RegExp(` {${LONG_SPACE},}|[\\s\\S]`, "gu");

/**
 * `text` as the preview prints it: escaped as `visible` does, every run of
 * spaces from `LONG_SPACE` on drawn as `␠×N`, and cut once the drawn form
 * passes `SHOWN_LIMIT`, with the number of characters left out. Display only: what is
 * hashed and run is always the text itself.
 */
export function shown(text) {
  let out = "";
  let used = 0;
  for (const piece of text.match(PIECES) ?? []) {
    const drawn = piece.length >= LONG_SPACE ? `␠×${piece.length}` : visible(piece);
    if (out.length + drawn.length > SHOWN_LIMIT) {
      return `${out}… [${text.length - used} more characters not shown]`;
    }
    out += drawn;
    used += piece.length;
  }
  return out;
}

/**
 * Report the error that ended a hook or a preview. Its message can carry text
 * from the repository, and the log and the pane are both read in a terminal.
 */
export function printFailure(prefix, error) {
  console.error(visible(`${prefix}: ${error.message}`));
}

/** Write every result to stdout, which Herdr keeps in the plugin command log. */
export function printReport(results) {
  for (const item of results) {
    const suffix = item.detail ? ` — ${item.detail}` : "";
    console.log(
      visible(`${item.status.padEnd(7)} ${item.action.padEnd(11)} ${item.path}${suffix}`),
    );
  }
}

/** A toast names the branch it is about, when the run knew one. */
const body = (line, branch) => (branch ? `${branch}: ${line}` : line);

// Where a skipped block is put right: the manifest title of the dry-run action,
// whose pane shows the commands and grants trust for them with one key.
export const TRUST_HINT = "open Preview worktree setup to read and trust them";

/** The body of a toast about a block the trust gate skipped, with the way out. */
const untrustedBody = (line, branch) => `${body(line, branch)}; ${TRUST_HINT}`;

/**
 * The toast a finished setup deserves, which is one either way. Skipped
 * commands get a title of their own: after the trust list changed format,
 * "ready" over a worktree whose setup never ran would be the only thing seen.
 */
export function setupToast(summary, line, branch) {
  if (summary.failed > 0) return { title: "Worktree setup incomplete", body: body(line, branch) };
  if (summary.untrusted > 0) {
    return { title: "Worktree ready, commands skipped", body: untrustedBody(line, branch) };
  }
  return { title: "Worktree ready", body: body(line, branch) };
}

/**
 * The toast a finished teardown deserves, or null when it deserves none. Only
 * a cleanup that did not happen is worth one: the worktree is gone and the
 * person has moved on, so a notification saying the cleanup went fine
 * interrupts for nothing, while one saying it failed, or never ran because the
 * repository is not trusted for it, is how they learn a container is still
 * running.
 */
export function cleanupToast(summary, line, branch) {
  if (summary.failed > 0) return { title: "Worktree cleanup incomplete", body: body(line, branch) };
  if (summary.untrusted > 0) {
    return { title: "Worktree cleanup skipped", body: untrustedBody(line, branch) };
  }
  return null;
}

/**
 * Show a Herdr toast. Best effort on purpose: a missing server or CLI comes
 * back in the return value, which we ignore, so nothing here can turn a
 * successful setup into a failed hook. The log already carries the full report.
 */
export function notify(title, body, env = process.env) {
  herdrCli(["notification", "show", title, "--body", body], env);
}
