import assert from "node:assert/strict";
import { after, test } from "node:test";
import { ConfigError, DEFAULTS, loadConfig, normalizeConfig } from "../src/config.mjs";
import { cleanup, makeRepo, write } from "./helpers.mjs";

after(cleanup);

test("a repository without a config file gets the defaults", () => {
  const repo = makeRepo();
  const config = loadConfig(repo);
  assert.equal(config.configured, false);
  assert.equal(config.auto_detect, DEFAULTS.auto_detect);
  assert.deepEqual(config.copy, []);
});

test("a config file overrides only the keys it sets", () => {
  const repo = makeRepo();
  write(
    repo,
    ".herdr-worktree.toml",
    ["auto_detect = false", 'copy = ["config/secrets.yml"]', "notify = false"].join("\n"),
  );

  const config = loadConfig(repo);
  assert.equal(config.configured, true);
  assert.equal(config.auto_detect, false);
  assert.deepEqual(config.copy, ["config/secrets.yml"]);
  assert.equal(config.notify, false);
  assert.equal(config.post_create_timeout_ms, DEFAULTS.post_create_timeout_ms);
});

test("an unknown key names itself instead of being ignored", () => {
  assert.throws(
    () => normalizeConfig({ auto_detekt: true }),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /auto_detekt/);
      assert.match(error.message, /Valid keys/);
      return true;
    },
  );
});

test("wrong value types are rejected", () => {
  assert.throws(() => normalizeConfig({ auto_detect: "yes" }), ConfigError);
  assert.throws(() => normalizeConfig({ copy: "one-path" }), ConfigError);
  assert.throws(() => normalizeConfig({ copy: [1, 2] }), ConfigError);
  assert.throws(() => normalizeConfig({ post_create_timeout_ms: -1 }), ConfigError);
});

test("paths that leave the repository are rejected", () => {
  assert.throws(() => normalizeConfig({ copy: ["../outside/.env"] }), ConfigError);
  assert.throws(() => normalizeConfig({ copy: ["/etc/passwd"] }), ConfigError);
  assert.throws(() => normalizeConfig({ symlink: ["C:\\Windows"] }), ConfigError);
  assert.throws(() => normalizeConfig({ copy: [""] }), ConfigError);
});
