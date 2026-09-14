import assert from "node:assert/strict";
import { test } from "node:test";
import { parseToml, TomlError } from "../src/toml.mjs";

test("reads booleans, strings, integers and arrays", () => {
  const config = parseToml(
    [
      "# leading comment",
      "auto_detect = true",
      "seed_from_example = false",
      "timeout_ms = 600_000",
      'copy = ["config/secrets.yml", "notes#1.txt"]',
      "symlink = [",
      '  "vendor",   # shared across worktrees',
      '  "target",',
      "]",
      'basic = "quoted \\"x\\" and \\n"',
      "literal = 'C:\\keep\\raw'",
    ].join("\n"),
  );

  assert.equal(config.auto_detect, true);
  assert.equal(config.seed_from_example, false);
  assert.equal(config.timeout_ms, 600000);
  assert.deepEqual(config.copy, ["config/secrets.yml", "notes#1.txt"]);
  assert.deepEqual(config.symlink, ["vendor", "target"]);
  assert.equal(config.basic, 'quoted "x" and \n');
  assert.equal(config.literal, "C:\\keep\\raw");
});

test("keeps a hash inside a string but drops a real comment", () => {
  const config = parseToml('copy = ["a#b"] # trailing');
  assert.deepEqual(config.copy, ["a#b"]);
});

test("nests one level of section headers", () => {
  const config = parseToml(["top = 1", "[tool]", "flag = false"].join("\n"));
  assert.equal(config.top, 1);
  assert.deepEqual(config.tool, { flag: false });
});

test("treats an empty document as an empty table", () => {
  assert.deepEqual(parseToml("\n# only a comment\n"), {});
});

test("rejects input outside the supported subset", () => {
  const cases = [
    "value = 1.5",
    "value = [unquoted]",
    'value = "unterminated',
    "no_equals_sign",
    "[[array.of.tables]]",
    'dup = "a"\ndup = "b"',
    'open = ["a",',
  ];
  for (const source of cases) {
    assert.throws(() => parseToml(source), TomlError, `expected a throw for: ${source}`);
  }
});
