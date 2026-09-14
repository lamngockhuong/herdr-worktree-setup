import { spawnSync } from "node:child_process";

const VERBS = {
  copy: "copied",
  symlink: "linked",
  seed: "seeded",
  post_create: "ran",
};

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
    const verb = VERBS[action] ?? action;
    const unit = action === "post_create" ? "command" : "file";
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
 * Show a Herdr toast. Best effort on purpose: a missing server or CLI must not
 * turn a successful setup into a failed hook.
 */
export function notify(title, body, env = process.env) {
  const bin = env.HERDR_BIN_PATH || "herdr";
  try {
    spawnSync(bin, ["notification", "show", title, "--body", body], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
  } catch {
    // Ignore: the log already carries the full report.
  }
}
