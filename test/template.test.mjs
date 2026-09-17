import assert from "node:assert/strict";
import { test } from "node:test";
import { FILTERS, render, shellEscape, worktreeVariables } from "../src/template.mjs";

// The variable set a hook would build for /repos/shop, worktree /repos/shop-feat.
const VARS = worktreeVariables({
  worktreePath: "/repos/shop-feat",
  repoRoot: "/repos/shop",
  branch: "feature/checkout",
});

const posix = (text, vars = VARS) => render(text, vars, "linux");

test("substitutes a bare variable", () => {
  assert.equal(posix("echo {{ branch }}"), "echo 'feature/checkout'");
  assert.equal(posix("echo {{branch}}"), "echo 'feature/checkout'");
  assert.equal(posix("echo {{   branch   }}"), "echo 'feature/checkout'");
});

test("derives every variable from the worktree and the repository", () => {
  assert.deepEqual(VARS, {
    branch: "feature/checkout",
    worktree_path: "/repos/shop-feat",
    worktree_name: "shop-feat",
    repo_path: "/repos/shop",
    repo_name: "shop",
  });
});

// These three values are a compatibility surface: changing one moves every
// user's ports and container names, and is a breaking change, not a fix.
test("the filters produce pinned values", () => {
  assert.equal(FILTERS.sanitize("feature/checkout"), "feature-checkout");
  assert.equal(FILTERS.sanitize("feature\\checkout"), "feature-checkout");
  assert.equal(FILTERS.hash("feature/checkout"), "l22");
  assert.equal(FILTERS.hash("main"), "hzc");
  assert.equal(FILTERS.hash_port("feature/checkout"), "13706");
  assert.equal(FILTERS.hash_port("main"), "13592");
});

test("hash is always three base36 characters", () => {
  for (const branch of ["a", "main", "feature/a-very-long-branch-name-indeed", "ß"]) {
    assert.match(FILTERS.hash(branch), /^[0-9a-z]{3}$/);
  }
});

test("hash_port stays inside 10000-19999", () => {
  for (let index = 0; index < 500; index++) {
    const port = Number(FILTERS.hash_port(`branch-${index}`));
    assert.ok(port >= 10000 && port <= 19999, `${port} is outside the range`);
  }
});

test("one branch keeps one port, and two branches get two", () => {
  assert.equal(posix("serve --port {{ branch | hash_port }}"), "serve --port '13706'");
  assert.equal(posix("serve --port {{ branch | hash_port }}"), "serve --port '13706'");

  const other = worktreeVariables({ worktreePath: "/w", repoRoot: "/r", branch: "main" });
  assert.equal(
    render("serve --port {{ branch | hash_port }}", other, "linux"),
    "serve --port '13592'",
  );
});

test("escapes a substituted value per platform", () => {
  assert.equal(shellEscape("a'b", "linux"), "'a'\\''b'");
  assert.equal(shellEscape("a'b", "win32"), "'a''b'");

  const vars = worktreeVariables({ worktreePath: "/w", repoRoot: "/r", branch: "a;rm -rf ~" });
  assert.equal(render("run {{ branch }}", vars, "linux"), "run 'a;rm -rf ~'");
  assert.equal(render("run {{ branch }}", vars, "win32"), "run 'a;rm -rf ~'");
});

test("leaves the author's own command text alone", () => {
  assert.equal(posix("sh -c 'echo {{ branch }}' && x"), "sh -c 'echo 'feature/checkout'' && x");
});

test("names the known variables when one is misspelled", () => {
  assert.throws(
    () => posix("echo {{ brunch }}"),
    (error) => {
      assert.match(error.message, /unknown variable "brunch"/);
      assert.match(error.message, /branch, worktree_path, worktree_name, repo_path, repo_name/);
      return true;
    },
  );
});

test("refuses to render an unset branch rather than render nothing", () => {
  const detached = worktreeVariables({ worktreePath: "/w", repoRoot: "/r", branch: null });
  assert.throws(
    () => render("serve --port {{ branch | hash_port }}", detached, "linux"),
    /"branch" has no value here: the worktree has no branch checked out/,
  );
});

test("an unterminated {{ is an error, not literal text", () => {
  assert.throws(() => posix("echo {{ branch"), /unterminated \{\{ in: echo \{\{ branch/);
});

test("names the known filters when one is misspelled", () => {
  assert.throws(() => posix("echo {{ branch | hashport }}"), /unknown filter "hashport"/);
});

test("rejects a chain of filters", () => {
  assert.throws(() => posix("echo {{ branch | sanitize | hash }}"), /only one filter is supported/);
});

test("text with no expression passes through untouched", () => {
  assert.equal(posix("pnpm install --frozen-lockfile"), "pnpm install --frozen-lockfile");
});

// A `docker --format` string, a Go template, a Helm chart: all of them write
// `{{ ... }}` too, and all of them worked before this plugin templated
// anything. Only an expression shaped like a variable name is claimed.
test("leaves another tool's braces alone", () => {
  for (const command of [
    "docker ps --format '{{.Names}}'",
    "docker inspect -f '{{ .State.Running }}' api",
    "kubectl get po -o go-template='{{range .items}}{{.metadata.name}}{{end}}'",
    "echo {{ my-var }}",
  ]) {
    assert.equal(posix(command), command);
  }
});

test("still claims an expression that names a variable", () => {
  assert.equal(posix("x {{.Names}} {{ branch }}"), "x {{.Names}} 'feature/checkout'");
  assert.throws(() => posix("docker ps --format '{{ brunch }}'"), /unknown variable "brunch"/);
});
