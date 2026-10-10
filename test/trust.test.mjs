import assert from "node:assert/strict";
import { join } from "node:path";
import { after, test } from "node:test";
import { commandsHash, readTrustList, TRUST_FILENAME, trustVerdict } from "../src/commands.mjs";
import { DEFAULTS, normalizeConfig } from "../src/config.mjs";
import { parseToml } from "../src/toml.mjs";
import { cleanup, configDir, makeRepo, write } from "./helpers.mjs";

after(cleanup);

const HASH = "a".repeat(64);
const OTHER = "b".repeat(64);

/** The hash of a config written as TOML, through the same parse a run uses. */
const hashOf = (toml) => commandsHash(normalizeConfig(parseToml(toml)));

test("reads one entry per line and ignores comments and blanks", () => {
  const dir = configDir(null);
  write(
    dir,
    TRUST_FILENAME,
    ["# repositories I wrote", "", `/one sha256:${HASH}`, `  /two sha256:${OTHER}  `, ""].join(
      "\n",
    ),
  );

  assert.deepEqual(readTrustList(dir), [
    { path: "/one", hash: HASH },
    { path: "/two", hash: OTHER },
  ]);
});

test("splits at the last space, so a path may contain spaces", () => {
  const dir = configDir(null);
  write(dir, TRUST_FILENAME, `C:\\Users\\Jane Doe\\repo sha256:${HASH}\n`);
  assert.deepEqual(readTrustList(dir), [{ path: "C:\\Users\\Jane Doe\\repo", hash: HASH }]);
});

test("reads the hash in either case and keeps it lower case", () => {
  const dir = configDir(null);
  write(dir, TRUST_FILENAME, `/one sha256:${HASH.toUpperCase()}\n`);
  assert.deepEqual(readTrustList(dir), [{ path: "/one", hash: HASH }]);
});

test("a line without a well-formed hash is read as a path alone", () => {
  const dir = configDir(null);
  write(dir, TRUST_FILENAME, ["/old", "/short sha256:abc", `/bad sha1:${HASH}`].join("\n"));

  assert.deepEqual(readTrustList(dir), [
    { path: "/old", hash: null },
    { path: "/short sha256:abc", hash: null },
    { path: `/bad sha1:${HASH}`, hash: null },
  ]);
});

test("a missing trust file trusts nothing rather than failing", () => {
  const dir = configDir(null);
  assert.deepEqual(readTrustList(dir), []);
  assert.equal(trustVerdict("/anywhere", HASH, [], {}), "unlisted");
});

test("trusts only a line matching both the path and the hash", () => {
  const repo = makeRepo();

  assert.equal(trustVerdict(repo, HASH, [{ path: repo, hash: HASH }], {}), "trusted");
  assert.equal(trustVerdict(repo, HASH, [{ path: repo, hash: OTHER }], {}), "changed");
  assert.equal(trustVerdict(repo, HASH, [{ path: repo, hash: null }], {}), "legacy");
});

test("any of several lines for one repository may grant trust", () => {
  const repo = makeRepo();
  const entries = [
    { path: repo, hash: OTHER },
    { path: repo, hash: HASH },
  ];
  assert.equal(trustVerdict(repo, HASH, entries, {}), "trusted");
});

test("a hashed line that no longer matches outranks a path-only one", () => {
  // Someone who has written one line in the new format already knows it; the
  // useful thing to tell them is that the commands moved.
  const repo = makeRepo();
  const entries = [
    { path: repo, hash: null },
    { path: repo, hash: OTHER },
  ];
  assert.equal(trustVerdict(repo, HASH, entries, {}), "changed");
});

test("matches the same repository however the path is spelled", () => {
  const repo = makeRepo();

  for (const path of [repo, `${repo}/.`, join(repo, "src", "..")]) {
    assert.equal(trustVerdict(repo, HASH, [{ path, hash: HASH }], {}), "trusted");
  }
  assert.equal(trustVerdict(`${repo}/.`, HASH, [{ path: repo, hash: HASH }], {}), "trusted");
});

test("does not match a different repository", () => {
  const repo = makeRepo();
  const other = makeRepo();
  assert.equal(trustVerdict(repo, HASH, [{ path: other, hash: HASH }], {}), "unlisted");
  assert.equal(trustVerdict(repo, HASH, [{ path: `${repo}-suffix`, hash: HASH }], {}), "unlisted");
});

test("the escape hatch trusts everything, hash or not", () => {
  assert.equal(
    trustVerdict("/anywhere", HASH, [], { HERDR_WORKTREE_SETUP_TRUST_ALL: "1" }),
    "trusted",
  );
  assert.equal(
    trustVerdict("/anywhere", HASH, [], { HERDR_WORKTREE_SETUP_TRUST_ALL: "yes" }),
    "unlisted",
  );
});

test("the hash ignores how the TOML is written and every other key", () => {
  const base = hashOf('post_create = ["pnpm install"]');

  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(hashOf("post_create = [\n  'pnpm install', # deps\n]\n"), base);
  assert.equal(hashOf('post_create = ["pnpm install"]\ncopy = [".env"]\nnotify = false'), base);
  assert.equal(hashOf('post_create = ["pnpm install"]\npost_remove = []'), base);
  assert.equal(hashOf('post_create = ["pnpm install"]\r\npost_create_timeout_ms = 5'), base);
});

test("the hash changes with any change to what would run", () => {
  const base = hashOf('post_create = ["pnpm install", "make"]');

  assert.notEqual(hashOf('post_create = ["pnpm install ", "make"]'), base);
  assert.notEqual(hashOf('post_create = ["make", "pnpm install"]'), base);
  assert.notEqual(hashOf('post_create = ["pnpm install", "make"]\npost_remove = ["x"]'), base);
});

test("a config with no commands hashes like the defaults", () => {
  assert.equal(hashOf(""), commandsHash(DEFAULTS));
});
