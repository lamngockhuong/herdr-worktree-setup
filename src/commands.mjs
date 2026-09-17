import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { result } from "./report.mjs";
import { render } from "./template.mjs";

export const TRUST_FILENAME = "trusted-repos.txt";

/**
 * Where the trust list lives. Both the run that skips a block and the preview
 * that says it would are quoting a file the reader now has to edit, so both
 * name it the same way rather than one of them naming it by filename alone.
 */
export const trustListPath = (configDir) =>
  join(configDir ?? "<plugin config dir>", TRUST_FILENAME);

const IS_WINDOWS = process.platform === "win32";

// `post_create` and `post_remove` run commands that a repository chose.
// Cloning someone's project and opening a worktree must not be enough to
// execute them, so the machine's owner opts each repository in by hand,
// outside the repository. One list covers both: a repository trusted to set a
// worktree up is trusted to tear it down again.
export function readTrustList(configDir) {
  if (!configDir) return [];
  try {
    return readFileSync(trustListPath(configDir), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

// The same repository can be spelled several ways: a symlinked /var on macOS,
// an 8.3 short name or either slash on Windows, a different case on both. Trust
// must survive all of them, so every path is reduced to one canonical form.
function canonical(path) {
  let resolved = resolve(path);
  try {
    resolved = realpathSync.native(resolved);
  } catch {
    // The path may not exist; the resolved form is the closest we can get.
  }
  return IS_WINDOWS ? resolved.replaceAll("\\", "/").toLowerCase() : resolved;
}

export function isTrusted(repoRoot, trusted, env = process.env) {
  if (env.HERDR_WORKTREE_SETUP_TRUST_ALL === "1") return true;
  const target = canonical(repoRoot);
  return trusted.some((entry) => canonical(entry) === target);
}

/**
 * The gate both command blocks pass through, wiring included. `--dry-run` has
 * to reach the same verdict as a real run, so both ask this rather than each
 * assembling the trust list and the environment for itself.
 */
export function trustedForCommands(repoRoot, configDir, env = process.env) {
  return isTrusted(repoRoot, readTrustList(configDir), env);
}

/**
 * Run one rendered command. Windows goes through PowerShell rather than the
 * `cmd.exe` that `shell: true` would pick: a single-quoted PowerShell string is
 * literal, which is what makes the escaping in `template.mjs` complete, and
 * `cmd.exe` cannot carry `%` or `!` safely inside a quoted argument. Spawning
 * the executable directly rather than passing `shell: "powershell.exe"` keeps
 * the user's PowerShell profile from running inside a hook and changing the
 * environment the commands see.
 */
function spawnCommand(command, cwd, timeoutMs) {
  const options = { cwd, encoding: "utf8", timeout: timeoutMs, windowsHide: true };
  if (!IS_WINDOWS) return spawnSync(command, { ...options, shell: true });

  // Let Node quote the command: PowerShell splits its command line by the same
  // C runtime rules and then rejoins what follows `-Command` with single
  // spaces, so one quoted argument survives intact while a verbatim command
  // line would come back with the author's own quotes eaten and every run of
  // whitespace collapsed.
  const args = ["-NoProfile", "-NonInteractive", "-Command", command];
  return spawnSync("powershell.exe", args, options);
}

// Falling back to `cmd.exe` would pair PowerShell escaping with a shell that
// reads it differently, which is the injection the escaping exists to prevent.
function spawnFailure(error) {
  if (IS_WINDOWS && error.code === "ENOENT") {
    return (
      `powershell.exe could not be started (${error.message}). Commands are not ` +
      "run through cmd.exe, whose quoting this plugin does not escape for"
    );
  }
  return error.message;
}

// Why one finished command counts as a failure, or null when it did not.
function failureDetail(run, timeoutMs) {
  if (run.error?.code === "ETIMEDOUT") {
    return (
      `timed out after ${timeoutMs}ms; the shell was killed, but anything it ` +
      "had already started may still be running"
    );
  }
  if (run.error) return spawnFailure(run.error);
  if (run.status !== 0) return `exit code ${run.status}`;
  return null;
}

/**
 * Render and run each configured command in `cwd`, stopping at the first
 * failure so a broken install does not cascade into confusing follow-up
 * errors. `action` names the block in the report, and every caller states it:
 * the two blocks are equal here, and a default would quietly mislabel a third.
 */
export function runCommands(
  cwd,
  commands,
  { timeoutMs, configDir, repoRoot, env, vars = {}, action },
) {
  if (commands.length === 0) return [];

  if (!trustedForCommands(repoRoot, configDir, env)) {
    const detail =
      `repository is not trusted for commands. To allow it, add this line to ` +
      `${trustListPath(configDir)}: ${repoRoot}`;
    return [result(action, repoRoot, "skipped", detail)];
  }

  const results = [];
  for (const command of commands) {
    // Render immediately before running, and report the command that actually
    // ran rather than the template it came from.
    let rendered;
    try {
      rendered = render(command, vars);
    } catch (error) {
      results.push(result(action, command, "failed", error.message));
      break;
    }

    const run = spawnCommand(rendered, cwd, timeoutMs);

    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
    if (output) console.log(output);

    const failure = failureDetail(run, timeoutMs);
    if (failure) {
      results.push(result(action, rendered, "failed", failure));
      break;
    }

    results.push(result(action, rendered, "done"));
  }
  return results;
}
