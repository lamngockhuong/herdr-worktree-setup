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

/** Write every result to stdout, which Herdr keeps in the plugin command log. */
export function printReport(results) {
  for (const item of results) {
    const suffix = item.detail ? ` — ${item.detail}` : "";
    console.log(`${item.status.padEnd(7)} ${item.action.padEnd(11)} ${item.path}${suffix}`);
  }
}

/** A toast names the branch it is about, when the run knew one. */
const body = (line, branch) => (branch ? `${branch}: ${line}` : line);

/**
 * The toast a finished setup deserves, which is one either way. Skipped
 * commands get a title of their own: after the trust list changed format,
 * "ready" over a worktree whose setup never ran would be the only thing seen.
 */
export function setupToast(summary, line, branch) {
  let title = "Worktree ready";
  if (summary.untrusted > 0) title = "Worktree ready, commands skipped";
  if (summary.failed > 0) title = "Worktree setup incomplete";
  return { title, body: body(line, branch) };
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
  if (summary.untrusted > 0) return { title: "Worktree cleanup skipped", body: body(line, branch) };
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
