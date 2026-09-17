import assert from "node:assert/strict";
import { join } from "node:path";
import { after, test } from "node:test";
import { isTrusted, readTrustList, TRUST_FILENAME } from "../src/commands.mjs";
import { cleanup, configDir, makeRepo, write } from "./helpers.mjs";

after(cleanup);

test("reads one path per line and ignores comments and blanks", () => {
  const dir = configDir(null);
  write(dir, TRUST_FILENAME, ["# repositories I wrote", "", "/one", "  /two  ", ""].join("\n"));

  assert.deepEqual(readTrustList(dir), ["/one", "/two"]);
});

test("a missing trust file trusts nothing rather than failing", () => {
  const dir = configDir(null);
  assert.deepEqual(readTrustList(dir), []);
  assert.equal(isTrusted("/anywhere", [], {}), false);
});

test("matches the same repository however the path is spelled", () => {
  const repo = makeRepo();

  assert.equal(isTrusted(repo, [repo], {}), true);
  assert.equal(isTrusted(repo, [`${repo}/.`], {}), true);
  assert.equal(isTrusted(repo, [join(repo, "src", "..")], {}), true);
  assert.equal(isTrusted(`${repo}/.`, [repo], {}), true);
});

test("does not match a different repository", () => {
  const repo = makeRepo();
  const other = makeRepo();
  assert.equal(isTrusted(repo, [other], {}), false);
  assert.equal(isTrusted(repo, [`${repo}-suffix`], {}), false);
});

test("the escape hatch trusts everything", () => {
  assert.equal(isTrusted("/anywhere", [], { HERDR_WORKTREE_SETUP_TRUST_ALL: "1" }), true);
  assert.equal(isTrusted("/anywhere", [], { HERDR_WORKTREE_SETUP_TRUST_ALL: "yes" }), false);
});
