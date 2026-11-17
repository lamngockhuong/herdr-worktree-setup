import assert from "node:assert/strict";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { ConfigError, DEFAULTS, loadConfig, normalizeConfig } from "../src/config.mjs";
import { parseToml } from "../src/toml.mjs";
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

test("a __proto__ section or key is reported like any other unknown key", () => {
  for (const source of ["[__proto__]\nauto_detect = true", '__proto__ = ["a"]']) {
    assert.throws(
      () => normalizeConfig(parseToml(source)),
      (error) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /unknown key\(s\): __proto__\./);
        return true;
      },
      `expected a throw for: ${source}`,
    );
  }
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

test("a path entry that is refused is named by position, not repeated", () => {
  for (const entry of ["/X\u001b]52;c;QQ==\u0007", "../SECRET-PATH"]) {
    assert.throws(
      () => normalizeConfig({ copy: ["fine", entry] }),
      (error) => {
        assert.match(error.message, /^copy entry 2 must /);
        assert.equal(error.message.includes(entry), false, error.message);
        return true;
      },
    );
  }
});

test("a config that is a symbolic link is refused without reading what it points at", () => {
  const outside = makeRepo({ "credentials.txt": "aws_secret = FAKEVALUE\n" });
  const repo = makeRepo();
  symlinkSync(join(outside, "credentials.txt"), join(repo, ".herdr-worktree.toml"));

  assert.throws(
    () => loadConfig(repo),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /\.herdr-worktree\.toml is a symbolic link/);
      assert.doesNotMatch(error.message, /FAKEVALUE|aws_secret/);
      return true;
    },
  );
});

test("a config that is not a regular file is refused", () => {
  const repo = makeRepo();
  mkdirSync(join(repo, ".herdr-worktree.toml"));

  assert.throws(() => loadConfig(repo), /\.herdr-worktree\.toml is not a regular file/);
});

test("a config larger than the limit is refused before it is read", () => {
  const repo = makeRepo();
  write(repo, ".herdr-worktree.toml", `# ${"x".repeat(64 * 1024)}\nnotify = false\n`);

  assert.throws(
    () => loadConfig(repo),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /larger than 64 KiB/);
      return true;
    },
  );
});
