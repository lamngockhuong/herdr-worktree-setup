import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const TRUST_FILENAME = "trusted-repos.txt";

// `post_create` runs commands that a repository chose. Cloning someone's
// project and opening a worktree must not be enough to execute them, so the
// machine's owner opts each repository in by hand, outside the repository.
export function readTrustList(configDir) {
  if (!configDir) return [];
  try {
    return readFileSync(join(configDir, TRUST_FILENAME), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export function isTrusted(repoRoot, trusted, env = process.env) {
  if (env.HERDR_WORKTREE_SETUP_TRUST_ALL === "1") return true;
  const target = resolve(repoRoot);
  return trusted.some((entry) => resolve(entry) === target);
}

/**
 * Run each configured command in the new checkout, stopping at the first
 * failure so a broken install does not cascade into confusing follow-up errors.
 */
export function runPostCreate(worktreePath, commands, { timeoutMs, configDir, repoRoot, env }) {
  if (commands.length === 0) return [];

  if (!isTrusted(repoRoot, readTrustList(configDir), env)) {
    return [
      {
        action: "post_create",
        path: repoRoot,
        status: "skipped",
        detail:
          `repository is not trusted for commands. To allow it, add this line to ` +
          `${join(configDir ?? "<plugin config dir>", TRUST_FILENAME)}: ${repoRoot}`,
      },
    ];
  }

  const results = [];
  for (const command of commands) {
    const run = spawnSync(command, {
      cwd: worktreePath,
      shell: true,
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
    });

    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
    if (output) console.log(output);

    if (run.error?.code === "ETIMEDOUT") {
      results.push({
        action: "post_create",
        path: command,
        status: "failed",
        detail: `timed out after ${timeoutMs}ms`,
      });
      break;
    }
    if (run.error) {
      results.push({
        action: "post_create",
        path: command,
        status: "failed",
        detail: run.error.message,
      });
      break;
    }
    if (run.status !== 0) {
      results.push({
        action: "post_create",
        path: command,
        status: "failed",
        detail: `exit code ${run.status}`,
      });
      break;
    }

    results.push({ action: "post_create", path: command, status: "done" });
  }
  return results;
}
