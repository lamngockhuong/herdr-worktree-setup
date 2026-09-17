import { mainWorktree } from "./git.mjs";

// Herdr hands the hook two JSON blobs. The invocation context carries a
// WorkspaceWorktreeInfo (checkout_path, repo_root); the event payload carries a
// WorktreeInfo (path) plus the workspace it belongs to. Either is enough, so we
// read whichever arrived rather than depending on one shape.
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
 * Resolve the new checkout and the repository it came from, from the plugin
 * environment. Throws when neither blob names a worktree, which is the only
 * case the hook cannot recover from.
 */
export function readContext(env = process.env) {
  const context = pluginContext(env);
  const event = parseJson(env.HERDR_PLUGIN_EVENT_JSON);

  const worktreePath =
    context?.worktree?.checkout_path ?? event?.worktree?.path ?? event?.worktree?.checkout_path;

  if (!worktreePath) {
    throw new Error(
      "no worktree in HERDR_PLUGIN_CONTEXT_JSON or HERDR_PLUGIN_EVENT_JSON; " +
        "is this running as a worktree.created hook?",
    );
  }

  const repoRoot =
    context?.worktree?.repo_root ??
    event?.workspace?.worktree?.repo_root ??
    mainWorktree(worktreePath);

  return {
    worktreePath,
    repoRoot,
    branch: context?.worktree?.branch ?? event?.worktree?.branch ?? null,
  };
}
