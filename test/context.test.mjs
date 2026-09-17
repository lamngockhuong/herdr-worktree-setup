import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readContext, resolveTarget } from "../src/context.mjs";
import { addWorktree, cleanup, makeRepo, pluginEnv } from "./helpers.mjs";

after(cleanup);

// A payload that names a branch is answered without touching the disk, so the
// two tests below hand over paths that never existed. That is the assertion:
// building a real checkout for them would hide a stray git call rather than
// prove there is none.
const NOWHERE = { repo: "/nowhere/repo", worktree: "/nowhere/repo/wt" };

test("reads the branch out of the event payload Herdr actually sends", () => {
  const context = readContext(pluginEnv(NOWHERE.repo, NOWHERE.worktree, {}, "feature/checkout"));

  assert.equal(context.branch, "feature/checkout");
  assert.equal(context.worktreePath, NOWHERE.worktree);
  assert.equal(context.repoRoot, NOWHERE.repo);
});

test("still names the branch once the checkout is gone", () => {
  // `worktree.removed` fires after the directory is deleted, so nothing can be
  // asked of git and the payload is the only source left.
  const gone = pluginEnv(NOWHERE.repo, NOWHERE.worktree, {}, "teardown");

  assert.equal(readContext(gone).branch, "teardown");
});

test("falls back to the checkout when the payload names no branch", () => {
  const repo = makeRepo();
  const worktree = addWorktree(repo, "from-git");

  assert.equal(readContext(pluginEnv(repo, worktree, {}, null)).branch, "from-git");
});

test("reports no branch for a worktree that has none", () => {
  const repo = makeRepo();
  const worktree = addWorktree(repo, null);

  assert.equal(readContext(pluginEnv(repo, worktree, {}, null)).branch, null);
});

test("says where the branch came from, so a silent fallback is not silent", () => {
  const repo = makeRepo();
  const worktree = addWorktree(repo, "sourced");

  assert.equal(readContext(pluginEnv(repo, worktree, {}, "sourced")).branchSource, "event");
  assert.equal(readContext(pluginEnv(repo, worktree, {}, null)).branchSource, "checkout");
});

test("the preview and the hook name the same branch by different routes", () => {
  // The preview reads a path off the command line and the hook reads an event,
  // and they once disagreed: the hook could not name a branch at all while the
  // preview kept printing the right one. Both now end in the same resolution.
  const repo = makeRepo();
  const worktree = addWorktree(repo, "agreed");

  const hook = readContext(pluginEnv(repo, worktree, {}, "agreed"));
  const preview = resolveTarget({}, [worktree]);

  assert.equal(preview.branch, hook.branch);
  assert.equal(preview.repoRoot, hook.repoRoot);
  assert.equal(preview.worktreePath, hook.worktreePath);
});

test("refuses to guess when no blob names a worktree at all", () => {
  assert.throws(() => readContext({}), /no worktree in HERDR_PLUGIN_CONTEXT_JSON/);
});
