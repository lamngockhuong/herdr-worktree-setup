import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { CONFIG_FILENAME, DEFAULTS, loadConfig, normalizeConfig } from "../src/config.mjs";
import { init, renderTemplate, resolveRepoRoot } from "../src/init.mjs";
import { parseToml } from "../src/toml.mjs";
import { addWorktree, cleanup, makeRepo, pluginEnv, write } from "./helpers.mjs";

after(cleanup);

test("writes a starter config that lists what it detects today", () => {
  const repo = makeRepo({}, { gitignore: ".env.local\n" });
  write(repo, "apps/api/.env.local", "API=1");

  assert.equal(init(pluginEnv(repo, repo), []), 0);

  const contents = readFileSync(join(repo, CONFIG_FILENAME), "utf8");
  assert.match(contents, /#\s+apps\/api\/\.env\.local/);
  assert.match(contents, /^# auto_detect = true$/m);
});

test("the generated file parses and normalizes to the defaults", () => {
  const repo = makeRepo({}, { gitignore: ".env\n" });
  write(repo, ".env", "A=1");
  init(pluginEnv(repo, repo), []);

  // Every key ships commented out, so writing the file must not change a single
  // thing about how the plugin behaves.
  const config = loadConfig(repo);
  assert.equal(config.configured, true);
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.deepEqual(config[key], value, `${key} drifted from its default`);
  }
});

test("every commented key in the template is a real, valid key", () => {
  const template = renderTemplate([]);
  const uncommented = template
    .split("\n")
    .map((line) => (line.startsWith("# ") && line.includes(" = ") ? line.slice(2) : line))
    .join("\n");

  const parsed = parseToml(uncommented);
  assert.deepEqual(Object.keys(parsed).sort(), Object.keys(DEFAULTS).sort());
  assert.doesNotThrow(() => normalizeConfig(parsed));
});

test("says so instead of overwriting an existing config", () => {
  const repo = makeRepo();
  write(repo, CONFIG_FILENAME, "notify = false\n");

  assert.equal(init(pluginEnv(repo, repo), []), 0);
  assert.equal(readFileSync(join(repo, CONFIG_FILENAME), "utf8"), "notify = false\n");
});

test("targets the main checkout even when invoked from a linked worktree", () => {
  const repo = makeRepo();
  const worktree = addWorktree(repo, "from-worktree");

  const env = { HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ workspace_cwd: worktree }) };
  assert.equal(resolveRepoRoot(env, []), repo);

  assert.equal(init(env, []), 0);
  assert.match(readFileSync(join(repo, CONFIG_FILENAME), "utf8"), /^# auto_detect = true$/m);
});

test("accepts a path argument for use outside Herdr", () => {
  const repo = makeRepo();
  assert.equal(resolveRepoRoot({}, [repo]), repo);
});
