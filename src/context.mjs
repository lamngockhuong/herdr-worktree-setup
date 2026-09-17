import { existsSync } from "node:fs";
import { currentBranch, mainWorktree, worktreeRoot } from "./git.mjs";

// Herdr hands the hook two JSON blobs. The invocation context carries a
// WorkspaceWorktreeInfo (checkout_path, repo_root); the event payload wraps a
// WorktreeInfo (path, branch) and its workspace in `{ event, data }`. Either is
// enough, so we read whichever arrived rather than depending on one shape.
function parseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Herdr's invocation-context blob, or null when it is absent or malformed. */
export function pluginContext(env = process.env) {
  return parseJson(env.HERDR_PLUGIN_CONTEXT_JSON);
}

/**
 * Where to look when no event names a worktree: the workspace Herdr says is
 * open, then the focused pane, then the current directory. `src/index.mjs` and
 * `src/init.mjs` both resolve a repository from this, and must agree on it.
 */
export function contextCwd(env = process.env) {
  const context = pluginContext(env);
  return context?.workspace_cwd ?? context?.focused_pane_cwd ?? process.cwd();
}

/**
 * The branch, and where it came from. Only the event payload names one — the
 * invocation context describes the workspace and carries no branch at all — so
 * git answers for the invocations that arrive without an event, such as
 * `--dry-run`. That answer needs the checkout, and `worktree.removed` fires
 * once the directory is gone, which is exactly when the payload has to be
 * believed.
 *
 * `source` is reported because this is the one resolution that can succeed for
 * the wrong reason: a hook that stopped reading the payload correctly would
 * still be handed the right branch by git, and say nothing, for as long as the
 * checkout exists. Every caller of this resolves a branch the same way, so the
 * preview and the hook cannot drift apart again.
 */
function readBranch(event, worktreePath) {
  const named = event?.worktree?.branch;
  if (named) return { branch: named, source: "event" };

  const fromCheckout = existsSync(worktreePath) ? currentBranch(worktreePath) : null;
  return fromCheckout
    ? { branch: fromCheckout, source: "checkout" }
    : { branch: null, source: null };
}

/**
 * Resolve the new checkout and the repository it came from, from the plugin
 * environment. Throws when neither blob names a worktree, which is the only
 * case the hook cannot recover from.
 */
export function readContext(env = process.env) {
  const context = pluginContext(env);
  // 0.9.1 wraps the payload in `{ event, data }`. The envelope is undocumented
  // in 0.7.0, which the manifest still supports, so an unwrapped blob is read
  // rather than assumed away.
  const payload = parseJson(env.HERDR_PLUGIN_EVENT_JSON);
  const event = payload?.data ?? payload;

  const worktreePath =
    context?.worktree?.checkout_path ?? event?.worktree?.path ?? event?.worktree?.checkout_path;

  if (!worktreePath) {
    throw new Error(
      "no worktree in HERDR_PLUGIN_CONTEXT_JSON or HERDR_PLUGIN_EVENT_JSON; " +
        "is this running as a worktree.created or worktree.removed hook?",
    );
  }

  const repoRoot =
    context?.worktree?.repo_root ??
    event?.workspace?.worktree?.repo_root ??
    mainWorktree(worktreePath);

  const { branch, source } = readBranch(event, worktreePath);

  return { worktreePath, repoRoot, branch, branchSource: source, event: event !== null };
}

/**
 * The target of an invocation that carries no event of its own: an explicit
 * path argument, then the worktree or workspace Herdr says is in focus, then
 * the current directory. `--dry-run` resolves what it previews this way.
 *
 * It ends in the same `readBranch` as the hook deliberately. Preview and hook
 * used to name the branch by two separate routes, which is how a hook that
 * could not read a branch at all kept printing the right one in its preview.
 */
export function resolveTarget(env = process.env, argv = []) {
  const explicit = argv.find((argument) => !argument.startsWith("-"));

  if (!explicit) {
    try {
      return readContext(env);
    } catch {
      // No worktree in either blob, which is the normal case for an action
      // invoked from a workspace. The cwd below answers it instead.
    }
  }

  const worktreePath = worktreeRoot(explicit ?? contextCwd(env));
  const { branch, source } = readBranch(null, worktreePath);

  return {
    worktreePath,
    repoRoot: mainWorktree(worktreePath),
    branch,
    branchSource: source,
    event: false,
  };
}
