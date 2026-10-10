import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanupToast, setupToast, summarize, summaryLine } from "../src/report.mjs";

const results = [
  { action: "copy", path: "a/.env", status: "done" },
  { action: "copy", path: "b/.env", status: "done" },
  { action: "copy", path: "c/.env", status: "skipped", detail: "already in the worktree" },
  { action: "symlink", path: "shared", status: "done" },
  { action: "post_create", path: "pnpm install", status: "failed", detail: "exit code 1" },
];

test("counts finished work and ignores skips", () => {
  assert.deepEqual(summarize(results), {
    done: { copy: 2, symlink: 1 },
    failed: 1,
    untrusted: 0,
  });
});

// A command block is only ever skipped by the trust gate: an existing file is
// skipped too, but that is the plugin doing its job, not a block that did not run.
const untrusted = [
  { action: "copy", path: "a/.env", status: "done" },
  { action: "post_create", path: "/repo", status: "skipped", detail: "not trusted" },
];

test("counts a command block the trust gate skipped, apart from skipped files", () => {
  assert.deepEqual(summarize(untrusted), { done: { copy: 1 }, failed: 0, untrusted: 1 });
  assert.equal(summaryLine(summarize(untrusted)), "copied 1 file, commands skipped: not trusted");
});

test("a setup whose commands were skipped does not call itself ready", () => {
  assert.deepEqual(setupToast(summarize(untrusted), "x", "feature/checkout"), {
    title: "Worktree ready, commands skipped",
    body: "feature/checkout: x",
  });
});

test("a teardown the trust gate skipped is worth a toast, since nothing was cleaned up", () => {
  const skipped = summarize([{ action: "post_remove", path: "/repo", status: "skipped" }]);
  assert.deepEqual(cleanupToast(skipped, "x", "feature/checkout"), {
    title: "Worktree cleanup skipped",
    body: "feature/checkout: x",
  });
});

test("writes a summary a human can read at a glance", () => {
  assert.equal(summaryLine(summarize(results)), "copied 2 files, linked 1 file, 1 failed");
});

test("counts one command in the singular", () => {
  const line = summaryLine(summarize([{ action: "post_create", path: "x", status: "done" }]));
  assert.equal(line, "ran 1 command");
});

test("says so when there was nothing to do", () => {
  assert.equal(summaryLine(summarize([])), "nothing to do");
});

test("a finished setup is announced either way, and names its branch", () => {
  const ok = summarize([{ action: "copy", path: "a/.env", status: "done" }]);
  assert.deepEqual(setupToast(ok, "copied 1 file", "feature/checkout"), {
    title: "Worktree ready",
    body: "feature/checkout: copied 1 file",
  });
  assert.deepEqual(setupToast(summarize(results), "1 failed", "feature/checkout"), {
    title: "Worktree setup incomplete",
    body: "feature/checkout: 1 failed",
  });
});

test("a detached worktree has no branch to put in front of the summary", () => {
  assert.equal(setupToast(summarize([]), "nothing to do", null).body, "nothing to do");
});

test("a teardown that went fine is not worth interrupting someone who has moved on", () => {
  const ok = summarize([{ action: "post_remove", path: "docker compose down", status: "done" }]);
  assert.equal(cleanupToast(ok, "ran 1 command", "feature/checkout"), null);

  const failed = summarize([{ action: "post_remove", path: "x", status: "failed" }]);
  assert.deepEqual(cleanupToast(failed, "1 failed", "feature/checkout"), {
    title: "Worktree cleanup incomplete",
    body: "feature/checkout: 1 failed",
  });
});
