import { spawnSync } from "node:child_process";

// The verb and the noun for each action, together: adding an action must not
// mean remembering a second table twenty lines further down.
const LABELS = {
  copy: ["copied", "file"],
  symlink: ["linked", "file"],
  seed: ["seeded", "file"],
  post_create: ["ran", "command"],
};

/**
 * One line of the report. Both `apply.mjs` and `post-create.mjs` produce these,
 * and everything below reads them, so the shape is defined here. A record with
 * nothing to add carries no `detail` key at all rather than an empty one.
 */
export const result = (action, path, status, detail) =>
  detail === undefined ? { action, path, status } : { action, path, status, detail };

/** Counts of what actually happened, keyed by action, ignoring skips. */
export function summarize(results) {
  const done = {};
  let failed = 0;
  for (const item of results) {
    if (item.status === "failed") failed++;
    if (item.status !== "done") continue;
    done[item.action] = (done[item.action] ?? 0) + 1;
  }
  return { done, failed };
}

/** One-line human summary, e.g. "copied 4 files, ran 1 command". */
export function summaryLine({ done, failed }) {
  const parts = Object.entries(done).map(([action, count]) => {
    const [verb, unit] = LABELS[action] ?? [action, "file"];
    return `${verb} ${count} ${count === 1 ? unit : `${unit}s`}`;
  });
  if (failed > 0) parts.push(`${failed} failed`);
  return parts.length > 0 ? parts.join(", ") : "nothing to do";
}

/** Write every result to stdout, which Herdr keeps in the plugin command log. */
export function printReport(results) {
  for (const item of results) {
    const suffix = item.detail ? ` — ${item.detail}` : "";
    console.log(`${item.status.padEnd(7)} ${item.action.padEnd(11)} ${item.path}${suffix}`);
  }
}

/**
 * Show a Herdr toast. Best effort on purpose: spawnSync reports a missing server
 * or CLI in its return value, which we ignore, so nothing here can turn a
 * successful setup into a failed hook. The log already carries the full report.
 * It waits rather than detaching, because the timeout is what guarantees a
 * wedged notification CLI is not left behind as an orphan.
 */
export function notify(title, body, env = process.env) {
  const bin = env.HERDR_BIN_PATH || "herdr";
  spawnSync(bin, ["notification", "show", title, "--body", body], {
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  });
}
