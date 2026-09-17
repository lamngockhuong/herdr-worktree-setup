import { spawnSync } from "node:child_process";

/**
 * Call the Herdr CLI and hand back the finished child. `HERDR_BIN_PATH` is how
 * Herdr tells a plugin where its own binary is; falling back to the name on
 * `PATH` covers a plugin run by hand. It waits rather than detaching, because
 * the timeout is what guarantees a wedged CLI is not left behind as an orphan.
 */
export function herdrCli(args, env = process.env) {
  return spawnSync(env.HERDR_BIN_PATH || "herdr", args, {
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  });
}
