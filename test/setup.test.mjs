import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { run } from "../src/index.mjs";
import { TRUST_FILENAME } from "../src/post-create.mjs";
import { addWorktree, cleanup, makeRepo, pluginEnv, write } from "./helpers.mjs";

after(cleanup);

const read = (root, relative) => readFileSync(join(root, relative), "utf8");

function configDirWith(trustedRepo) {
  const dir = mkdtempSync(join(tmpdir(), "herdr-wt-cfg-"));
  if (trustedRepo) write(dir, TRUST_FILENAME, `# trusted\n${trustedRepo}\n`);
  return dir;
}

test("copies detected config into a fresh worktree with no setup at all", () => {
  const repo = makeRepo({ "README.md": "hi" }, { gitignore: ".env.local\n" });
  write(repo, "apps/api/.env.local", "API_KEY=from-main");
  write(repo, "apps/web/.env.local", "WEB=1");
  const worktree = addWorktree(repo, "copy-default");

  assert.equal(run(pluginEnv(repo, worktree)), 0);
  assert.equal(read(worktree, "apps/api/.env.local"), "API_KEY=from-main");
  assert.equal(read(worktree, "apps/web/.env.local"), "WEB=1");
});

test("leaves a file the worktree already has untouched", () => {
  const repo = makeRepo({}, { gitignore: ".env\n" });
  write(repo, ".env", "FROM=main");
  const worktree = addWorktree(repo, "no-clobber");
  write(worktree, ".env", "FROM=worktree");

  assert.equal(run(pluginEnv(repo, worktree)), 0);
  assert.equal(read(worktree, ".env"), "FROM=worktree");
});

test("honours explicit copy and symlink entries from the config file", () => {
  const repo = makeRepo({}, { gitignore: "secrets/\nshared/\n" });
  write(repo, "secrets/keystore.p12", "binary");
  write(repo, "shared/cache/blob.bin", "big");
  write(
    repo,
    ".herdr-worktree.toml",
    [
      "auto_detect = false",
      'copy = ["secrets/keystore.p12"]',
      'symlink = ["shared"]',
      "notify = false",
    ].join("\n"),
  );
  const worktree = addWorktree(repo, "explicit");

  assert.equal(run(pluginEnv(repo, worktree)), 0);
  assert.equal(read(worktree, "secrets/keystore.p12"), "binary");
  assert.equal(lstatSync(join(worktree, "shared")).isSymbolicLink(), true);
  assert.equal(read(worktree, "shared/cache/blob.bin"), "big");
});

test("seeds a missing file from its committed example only when asked", () => {
  const files = { "apps/api/.env.local.example": "API_KEY=replace-me" };
  const repo = makeRepo(files, { gitignore: ".env.local\n" });
  const untouched = addWorktree(repo, "no-seed");

  assert.equal(run(pluginEnv(repo, untouched)), 0);
  assert.equal(existsSync(join(untouched, "apps/api/.env.local")), false);

  write(repo, ".herdr-worktree.toml", "seed_from_example = true\nnotify = false");
  const seeded = addWorktree(repo, "seed");

  assert.equal(run(pluginEnv(repo, seeded)), 0);
  assert.equal(read(seeded, "apps/api/.env.local"), "API_KEY=replace-me");
});

test("refuses to run repository commands until the machine owner trusts the repo", () => {
  const marker = 'require("node:fs").writeFileSync("ran.txt", "yes");';
  const repo = makeRepo({ "setup-marker.cjs": marker });
  write(repo, ".herdr-worktree.toml", 'post_create = ["node setup-marker.cjs"]\nnotify = false');

  const blocked = addWorktree(repo, "untrusted");
  assert.equal(run(pluginEnv(repo, blocked, { HERDR_PLUGIN_CONFIG_DIR: configDirWith() })), 0);
  assert.equal(existsSync(join(blocked, "ran.txt")), false);

  const allowed = addWorktree(repo, "trusted");
  const env = pluginEnv(repo, allowed, { HERDR_PLUGIN_CONFIG_DIR: configDirWith(repo) });
  assert.equal(run(env), 0);
  assert.equal(read(allowed, "ran.txt"), "yes");
});

test("reports a failing setup command as a failed run", () => {
  const repo = makeRepo({ "fail.cjs": "process.exit(3);" });
  write(repo, ".herdr-worktree.toml", 'post_create = ["node fail.cjs"]\nnotify = false');
  const worktree = addWorktree(repo, "failing");

  const env = pluginEnv(repo, worktree, { HERDR_PLUGIN_CONFIG_DIR: configDirWith(repo) });
  assert.equal(run(env), 1);
});

test("fails loudly when Herdr passes no worktree at all", () => {
  assert.throws(() => run({}), /no worktree in HERDR_PLUGIN_CONTEXT_JSON/);
});
