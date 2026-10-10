import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
const trustListPath = (configDir) => join(configDir ?? "<plugin config dir>", TRUST_FILENAME);

const IS_WINDOWS = process.platform === "win32";

// `post_create` and `post_remove` run commands that a repository chose.
// Cloning someone's project and opening a worktree must not be enough to
// execute them, so the machine's owner opts each repository in by hand,
// outside the repository. One list covers both: a repository trusted to set a
// worktree up is trusted to tear it down again.
//
// A line names the repository and the commands it was trusted with, as
// `<path> sha256:<hex>`. The path alone is not enough: the commands are read
// from whatever the main checkout holds, so a branch checked out for review
// could otherwise swap them for its own and inherit the trust.

/**
 * The fingerprint a trust line carries. Taken from the parsed config, so how
 * the TOML is written does not matter, and before rendering, since the
 * rendered commands name the worktree and would never match twice. Only the
 * two blocks that run commands are covered: changing `copy` or `notify` should
 * not demand trusting the repository again.
 */
export function commandsHash({ post_create, post_remove }) {
  return createHash("sha256").update(JSON.stringify({ post_create, post_remove })).digest("hex");
}

/** The line that trusts `repoRoot` with the commands hashed as `hash`. */
export const trustLine = (repoRoot, hash) => `${repoRoot} sha256:${hash}`;

const HASH_TOKEN = /^sha256:([0-9a-f]{64})$/i;

// Split at the last whitespace, so a path holding spaces survives. A line with
// no well-formed hash is kept as a path alone: it grants nothing, but it lets
// the skip message say the line is in the old format rather than missing.
function parseTrustLine(line) {
  const split = line.search(/\s\S+$/);
  const match = split === -1 ? null : HASH_TOKEN.exec(line.slice(split + 1));
  if (!match) return { path: line, hash: null };
  return { path: line.slice(0, split).trim(), hash: match[1].toLowerCase() };
}

export function readTrustList(configDir) {
  if (!configDir) return [];
  try {
    return readFileSync(trustListPath(configDir), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map(parseTrustLine);
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

/**
 * Whether a repository may run commands with this hash, and if not, why:
 * `unlisted` when no line names it, `legacy` when only a path-only line does,
 * `changed` when a hashed line does but for other commands. Several lines may
 * name one repository, and any match is enough.
 */
export function trustVerdict(repoRoot, hash, entries, env = process.env) {
  if (env.HERDR_WORKTREE_SETUP_TRUST_ALL === "1") return "trusted";
  const target = canonical(repoRoot);
  const mine = entries.filter((entry) => canonical(entry.path) === target);
  if (mine.some((entry) => entry.hash === hash)) return "trusted";
  if (mine.some((entry) => entry.hash !== null)) return "changed";
  return mine.length > 0 ? "legacy" : "unlisted";
}

/**
 * The gate both command blocks pass through, wiring included. `--dry-run` has
 * to reach the same verdict as a real run, so both ask this rather than each
 * assembling the hash, the trust list and the environment for itself. The
 * hash comes back too, for the line a skip has to print.
 */
export function commandsVerdict(repoRoot, config, configDir, env = process.env) {
  const hash = commandsHash(config);
  return { verdict: trustVerdict(repoRoot, hash, readTrustList(configDir), env), hash };
}

/**
 * Why a repository's commands are skipped, ending in the exact line that would
 * allow them. Every reason sends the reader to the dry run first: the line
 * approves whatever the commands are now, so it should not be pasted unread.
 */
export function untrustedDetail(verdict, repoRoot, hash, configDir) {
  const file = trustListPath(configDir);
  const line = trustLine(repoRoot, hash);
  if (verdict === "legacy") {
    return (
      `${file} lists this repository without a hash, which no longer grants trust. ` +
      `Read the commands with the dry-run action, then replace that line with: ${line}`
    );
  }
  const why =
    verdict === "changed"
      ? "post_create or post_remove changed since this repository was trusted"
      : "repository is not trusted for commands";
  return `${why}. Read them with the dry-run action, then add this line to ${file}: ${line}`;
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
  { timeoutMs, configDir, repoRoot, config, env, vars = {}, action },
) {
  if (commands.length === 0) return [];

  const { verdict, hash } = commandsVerdict(repoRoot, config, configDir, env);
  if (verdict !== "trusted") {
    const detail = untrustedDetail(verdict, repoRoot, hash, configDir);
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
