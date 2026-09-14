import assert from "node:assert/strict";
import { after, test } from "node:test";
import { detectFiles, isExample, matchesAny } from "../src/detect.mjs";
import { cleanup, makeRepo, write } from "./helpers.mjs";

after(cleanup);

const IGNORE_LOCAL = [".env", ".env.local", "*.local", "libs/", ".envrc", "*.tfvars"].join("\n");

test("finds git-ignored config files anywhere in the tree", () => {
  const repo = makeRepo({ "README.md": "hi" }, { gitignore: IGNORE_LOCAL });
  write(repo, ".env", "ROOT=1");
  write(repo, "apps/api/.env.local", "API=1");
  write(repo, "packages/db/.env.local", "DB=1");
  write(repo, ".envrc", "use flake");
  write(repo, "infra/prod.tfvars", "region=ap");

  assert.deepEqual(detectFiles(repo), [
    ".env",
    ".envrc",
    "apps/api/.env.local",
    "infra/prod.tfvars",
    "packages/db/.env.local",
  ]);
});

test("leaves committed placeholders and tracked files alone", () => {
  const repo = makeRepo(
    { ".env.example": "KEY=", "apps/api/.env.sample": "KEY=", "config.yml": "a: 1" },
    { gitignore: ".env\n" },
  );
  write(repo, ".env", "KEY=real");

  assert.deepEqual(detectFiles(repo), [".env"]);
});

test("never descends into a wholly ignored directory", () => {
  const repo = makeRepo({}, { gitignore: "libs/\n" });
  write(repo, "libs/pkg/.env", "NESTED=1");

  assert.deepEqual(detectFiles(repo), []);
});

test("probes known nested secrets that git collapsed away", () => {
  const repo = makeRepo({}, { gitignore: "config/master.key\nconfig/credentials/\n" });
  write(repo, "config/master.key", "abc");
  write(repo, "config/credentials/production.key", "def");

  assert.deepEqual(detectFiles(repo), ["config/credentials/production.key", "config/master.key"]);
});

test("finds a config file whose name is not plain ASCII", () => {
  const repo = makeRepo({}, { gitignore: ".env*\n" });
  write(repo, ".env.local", "A=1");
  write(repo, ".env.caf\u00e9", "B=1");

  assert.deepEqual(detectFiles(repo), [".env.caf\u00e9", ".env.local"]);
});

test("a replaced pattern list also turns the nested probes off", () => {
  const repo = makeRepo({}, { gitignore: "config/master.key\nsecrets.yaml\n" });
  write(repo, "config/master.key", "abc");
  write(repo, "secrets.yaml", "token: 1");

  assert.deepEqual(detectFiles(repo, { patterns: ["**/secrets.yaml"] }), ["secrets.yaml"]);
});

test("exclude trims the auto-detected list", () => {
  const repo = makeRepo({}, { gitignore: ".env*\n" });
  write(repo, ".env", "A=1");
  write(repo, ".env.ci", "B=1");

  assert.deepEqual(detectFiles(repo, { exclude: ["**/.env.ci"] }), [".env"]);
});

test("classifies placeholder suffixes and matches globs", () => {
  assert.equal(isExample("apps/api/.env.Example"), true);
  assert.equal(isExample("apps/api/.env.local"), false);
  assert.equal(matchesAny("apps/api/.env.local", ["**/.env.*"]), true);
  assert.equal(matchesAny("apps\\api\\.env.local", ["**/.env.*"]), true);
  assert.equal(matchesAny("apps/api/config.yml", ["**/.env.*"]), false);
});
