import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { run } from "../src/remove.mjs";
import {
  addWorktree,
  cleanup,
  configDir,
  makeRepo,
  removedEnv,
  repoRunningCommand,
  writeArgScript,
} from "./helpers.mjs";

after(cleanup);

/** A repository whose teardown records the argument it was given. */
const repoTearingDown = (command) =>
  repoRunningCommand("post_remove", command, { "write-arg.cjs": writeArgScript("torn-down.txt") });

/**
 * The path of a checkout that is gone, which is all the hook ever sees: it
 * reads the branch from the event and runs in the repository, so nothing here
 * touches the directory. One test below builds and deletes a real worktree to
 * hold that claim honest; the rest need only the name.
 */
const goneWorktree = (repo, branch) => join(repo, "..", `gone-${branch.replaceAll("/", "-")}`);

test("runs the teardown in the repository, since the checkout is gone", () => {
  const repo = repoTearingDown("node write-arg.cjs {{ branch | sanitize }}");
  // The one case that reproduces the real lifecycle: Herdr deletes the checkout
  // and only then fires the event.
  const worktree = addWorktree(repo, "feature/checkout");
  rmSync(worktree, { recursive: true, force: true });
  const env = removedEnv(
    repo,
    worktree,
    { HERDR_PLUGIN_CONFIG_DIR: configDir(repo) },
    "feature/checkout",
  );

  assert.equal(run(env), 0);
  assert.equal(readFileSync(join(repo, "torn-down.txt"), "utf8"), "feature-checkout");
});

test("names the branch from the event, which is all that is left to ask", () => {
  // The directory is gone, so git cannot answer and the payload has to. A port
  // that matches the one setup used is the whole point: it is what lets the
  // teardown find the container the setup started.
  const repo = repoTearingDown("node write-arg.cjs {{ branch | hash_port }}");
  const worktree = goneWorktree(repo, "feature/checkout");
  const env = removedEnv(
    repo,
    worktree,
    { HERDR_PLUGIN_CONFIG_DIR: configDir(repo) },
    "feature/checkout",
  );

  assert.equal(run(env), 0);
  assert.equal(readFileSync(join(repo, "torn-down.txt"), "utf8"), "13706");
});

test("skips the teardown of a repository nobody trusted", () => {
  const repo = repoTearingDown("node write-arg.cjs {{ branch }}");
  const worktree = goneWorktree(repo, "untrusted");
  const env = removedEnv(repo, worktree, { HERDR_PLUGIN_CONFIG_DIR: configDir(null) }, "untrusted");

  assert.equal(run(env), 0);
  assert.equal(existsSync(join(repo, "torn-down.txt")), false);
});

test("does nothing at all for a repository that configured no teardown", () => {
  const repo = makeRepo({ "write-arg.cjs": writeArgScript("torn-down.txt") });
  const worktree = goneWorktree(repo, "no-teardown");

  assert.equal(run(removedEnv(repo, worktree)), 0);
  assert.equal(existsSync(join(repo, "torn-down.txt")), false);
});

test("reports a failing teardown rather than swallowing it", () => {
  const repo = repoTearingDown("node -e process.exit(3)");
  const worktree = goneWorktree(repo, "broken");
  const env = removedEnv(repo, worktree, { HERDR_PLUGIN_CONFIG_DIR: configDir(repo) }, "broken");

  assert.equal(run(env), 1);
});
