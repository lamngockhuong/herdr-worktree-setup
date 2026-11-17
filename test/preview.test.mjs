import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { readTrustList, TRUST_FILENAME } from "../src/commands.mjs";
import { ENTRYPOINT_ID, main, PLUGIN_ID, paneFailure } from "../src/preview.mjs";
import {
  addWorktree,
  cleanup,
  configDir,
  makeRepo,
  pluginEnv,
  repoRunningCommand,
  runEntry,
  trustLineFor,
  write,
} from "./helpers.mjs";

after(cleanup);

test("--pane renders the preview and touches nothing", () => {
  const repo = makeRepo({}, { gitignore: ".env\n" });
  write(repo, ".env", "FROM=main");
  const worktree = addWorktree(repo, "pane");

  const result = runEntry("src/preview.mjs", ["--pane"], pluginEnv(repo, worktree, {}, "pane"));

  assert.equal(result.status, 0);
  assert.match(result.stdout, /dry run: nothing is linked, copied, seeded or executed/);
  assert.match(result.stdout, /would copy \.env/);
});

test("an action that cannot open the pane says why and still prints the preview", () => {
  const repo = makeRepo({}, { gitignore: ".env\n" });
  write(repo, ".env", "FROM=main");
  const worktree = addWorktree(repo, "no-pane");

  // pluginEnv points HERDR_BIN_PATH at a binary that is not there, which is
  // what any failure to reach the CLI looks like from here.
  const result = runEntry("src/preview.mjs", [], pluginEnv(repo, worktree, {}, "no-pane"));

  assert.equal(result.status, 0);
  assert.match(result.stderr, /could not open the preview pane/);
  assert.match(result.stdout, /would copy \.env/);
});

test("an opened pane is read as success however the CLI words it", () => {
  // A plugin pane reports itself; a popup, having no pane id to report, says ok.
  for (const type of ["plugin_pane_opened", "ok"]) {
    const stdout = JSON.stringify({ id: "cli:plugin", result: { type } });
    assert.equal(paneFailure({ status: 0, stdout, stderr: "" }), null, type);
  }
});

test("a refused pane reports what the CLI said", () => {
  const refusal = { id: "cli:plugin", error: { code: "ui_busy", message: "a modal is open" } };
  assert.match(paneFailure({ status: 0, stdout: JSON.stringify(refusal), stderr: "" }), /ui_busy/);

  assert.equal(paneFailure({ error: new Error("spawn herdr ENOENT") }), "spawn herdr ENOENT");
  assert.equal(paneFailure({ status: 1, stdout: "", stderr: "boom\n" }), "boom");
});

test("the pane it opens is the one the manifest declares", () => {
  const manifest = readFileSync(join(import.meta.dirname, "../herdr-plugin.toml"), "utf8");

  assert.match(manifest, new RegExp(`^id = "${PLUGIN_ID}"$`, "m"));
  assert.match(manifest, new RegExp(`^\\[\\[panes\\]\\]\\nid = "${ENTRYPOINT_ID}"$`, "m"));
  assert.match(manifest, /^command = \["node", "src\/preview\.mjs", "--pane"\]$/m);
  assert.match(manifest, /^command = \["node", "src\/preview\.mjs"\]$/m);
});

/**
 * Run the pane in-process as if a person sat at it, pressing `keys` in order.
 * Before each key it calls `beforeKey` with the index, so a test can change
 * the world between the preview being drawn and the key being pressed.
 */
async function pane(t, env, keys, beforeKey = () => {}) {
  const lines = [];
  t.mock.method(console, "log", (...args) => lines.push(args.join(" ")));
  t.mock.method(console, "error", (...args) => lines.push(args.join(" ")));

  let pressed = 0;
  const readKey = async () => {
    assert.ok(pressed < keys.length, `the pane asked for key ${pressed + 1}:\n${lines.join("\n")}`);
    beforeKey(pressed);
    return keys[pressed++];
  };

  const code = await main(env, ["--pane"], { interactive: true, readKey });
  t.mock.restoreAll();
  return { code, output: lines.join("\n"), pressed };
}

function untrustedRepo() {
  const repo = repoRunningCommand("post_create", "node write-arg.cjs");
  const worktree = addWorktree(repo, "trust-me");
  const cfg = configDir(null);
  const env = pluginEnv(repo, worktree, { HERDR_PLUGIN_CONFIG_DIR: cfg }, "trust-me");
  return { repo, cfg, env };
}

test("pressing t in the pane trusts the commands it showed", async (t) => {
  const { repo, cfg, env } = untrustedRepo();

  const { code, output, pressed } = await pane(t, env, ["t", "x"]);

  assert.equal(code, 0);
  assert.equal(pressed, 2, "the pane must stay open after trusting, to show what it wrote");
  assert.match(output, /press t to trust these commands/);
  assert.match(output, /trusted: added /);
  assert.equal(readFileSync(join(cfg, TRUST_FILENAME), "utf8"), `${trustLineFor(repo)}\n`);
});

test("any other key closes the pane and trusts nothing", async (t) => {
  const { cfg, env } = untrustedRepo();

  for (const key of ["x", "\u0003", "\u001b", "tt"]) {
    const { pressed } = await pane(t, env, [key]);
    assert.equal(pressed, 1, JSON.stringify(key));
  }
  assert.equal(existsSync(join(cfg, TRUST_FILENAME)), false);
});

test("commands changed after the preview was drawn are not trusted", async (t) => {
  const { repo, cfg, env } = untrustedRepo();

  const { output } = await pane(t, env, ["t", "x"], (index) => {
    if (index === 0) write(repo, ".herdr-worktree.toml", 'post_create = ["echo swapped"]');
  });

  assert.match(output, /not trusted: post_create or post_remove changed after this preview/);
  assert.equal(existsSync(join(cfg, TRUST_FILENAME)), false);
});

test("a config broken before the key press trusts nothing and still closes", async (t) => {
  const { repo, cfg, env } = untrustedRepo();

  const { output, pressed } = await pane(t, env, ["t", "x"], (index) => {
    if (index === 0) write(repo, ".herdr-worktree.toml", "no_such_key = 1");
  });

  assert.equal(pressed, 2);
  assert.match(output, /not trusted: /);
  assert.equal(existsSync(join(cfg, TRUST_FILENAME)), false);
});

test("a trust list without a final newline keeps its last line intact", async (t) => {
  const { repo, cfg, env } = untrustedRepo();
  write(cfg, TRUST_FILENAME, "# mine\n/elsewhere");

  await pane(t, env, ["t", "x"]);

  const entries = readTrustList(cfg);
  assert.deepEqual(
    entries.map((entry) => entry.path),
    ["/elsewhere", repo],
  );
});

test("a trusted repository, or one with no commands, is not offered trust", async (t) => {
  const trusted = repoRunningCommand("post_create", "node write-arg.cjs");
  const trustedEnv = pluginEnv(
    trusted,
    addWorktree(trusted, "trusted"),
    { HERDR_PLUGIN_CONFIG_DIR: configDir(trusted) },
    "trusted",
  );

  const plain = makeRepo();
  const plainEnv = pluginEnv(
    plain,
    addWorktree(plain, "plain"),
    { HERDR_PLUGIN_CONFIG_DIR: configDir(null) },
    "plain",
  );

  for (const env of [trustedEnv, plainEnv]) {
    const { output, pressed } = await pane(t, env, ["t"]);
    assert.equal(pressed, 1);
    assert.doesNotMatch(output, /press t to trust/);
    assert.match(output, /press any key to close/);
  }
});

test("without a config directory the pane cannot write trust and does not offer it", async (t) => {
  const repo = repoRunningCommand("post_create", "node write-arg.cjs");
  const env = pluginEnv(repo, addWorktree(repo, "no-cfg"), {}, "no-cfg");
  // The developer running the suite may have Herdr's variable set themselves.
  env.HERDR_PLUGIN_CONFIG_DIR = "";

  const { output } = await pane(t, env, ["t"]);
  assert.doesNotMatch(output, /press t to trust/);
});

test("a pane with nobody at it never prompts and never writes", () => {
  const { cfg, env } = untrustedRepo();

  const result = runEntry("src/preview.mjs", ["--pane"], env);

  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /press t to trust/);
  assert.equal(existsSync(join(cfg, TRUST_FILENAME)), false);
});
