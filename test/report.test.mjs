import assert from "node:assert/strict";
import { test } from "node:test";
import { summarize, summaryLine } from "../src/report.mjs";

const results = [
  { action: "copy", path: "a/.env", status: "done" },
  { action: "copy", path: "b/.env", status: "done" },
  { action: "copy", path: "c/.env", status: "skipped", detail: "already in the worktree" },
  { action: "symlink", path: "shared", status: "done" },
  { action: "post_create", path: "pnpm install", status: "failed", detail: "exit code 1" },
];

test("counts finished work and ignores skips", () => {
  assert.deepEqual(summarize(results), { done: { copy: 2, symlink: 1 }, failed: 1 });
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
