import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { ENTRYPOINT_ID, PLUGIN_ID, paneFailure } from "../src/preview.mjs";
import { addWorktree, cleanup, makeRepo, pluginEnv, runEntry, write } from "./helpers.mjs";

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
