import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { run } from "../src/index.mjs";
import { runPostCreate, TRUST_FILENAME } from "../src/post-create.mjs";
import { worktreeVariables } from "../src/template.mjs";
import { addWorktree, cleanup, makeRepo, pluginEnv, write } from "./helpers.mjs";

after(cleanup);

const read = (root, relative) => readFileSync(join(root, relative), "utf8");

function configDirWith(trustedRepo) {
  const dir = mkdtempSync(join(tmpdir(), "herdr-wt-cfg-"));
  if (trustedRepo) write(dir, TRUST_FILENAME, `# trusted\n${trustedRepo}\n`);
  return dir;
}

test("copies detected config into a fresh worktree with no setup at all", () => {
  const repo = makeRepo({ "README.md": "hi" }, { gitignore: ".env.local\n" });
  write(repo, "apps/api/.env.local", "API_KEY=from-main");
  write(repo, "apps/web/.env.local", "WEB=1");
  const worktree = addWorktree(repo, "copy-default");

  assert.equal(run(pluginEnv(repo, worktree)), 0);
  assert.equal(read(worktree, "apps/api/.env.local"), "API_KEY=from-main");
  assert.equal(read(worktree, "apps/web/.env.local"), "WEB=1");
});

test("leaves a file the worktree already has untouched", () => {
  const repo = makeRepo({}, { gitignore: ".env\n" });
  write(repo, ".env", "FROM=main");
  const worktree = addWorktree(repo, "no-clobber");
  write(worktree, ".env", "FROM=worktree");

  assert.equal(run(pluginEnv(repo, worktree)), 0);
  assert.equal(read(worktree, ".env"), "FROM=worktree");
});

test("honours explicit copy and symlink entries from the config file", () => {
  const repo = makeRepo({}, { gitignore: "secrets/\nshared/\n" });
  write(repo, "secrets/keystore.p12", "binary");
  write(repo, "shared/cache/blob.bin", "big");
  write(
    repo,
    ".herdr-worktree.toml",
    [
      "auto_detect = false",
      'copy = ["secrets/keystore.p12"]',
      'symlink = ["shared"]',
      "notify = false",
    ].join("\n"),
  );
  const worktree = addWorktree(repo, "explicit");

  assert.equal(run(pluginEnv(repo, worktree)), 0);
  assert.equal(read(worktree, "secrets/keystore.p12"), "binary");
  assert.equal(lstatSync(join(worktree, "shared")).isSymbolicLink(), true);
  assert.equal(read(worktree, "shared/cache/blob.bin"), "big");
});

test("links a directory before copying anything into it", () => {
  const repo = makeRepo({}, { gitignore: ".env\nshared/blob.bin\n" });
  write(repo, "shared/.env", "SHARED=1");
  write(repo, "shared/blob.bin", "big");
  write(repo, ".herdr-worktree.toml", 'symlink = ["shared"]\nnotify = false');
  const worktree = addWorktree(repo, "link-then-copy");

  assert.equal(run(pluginEnv(repo, worktree)), 0);
  assert.equal(lstatSync(join(worktree, "shared")).isSymbolicLink(), true);
  assert.equal(read(worktree, "shared/blob.bin"), "big");
});

test("reproduces a config symlink whose destination does not exist", () => {
  const repo = makeRepo({}, { gitignore: ".env\n" });
  symlinkSync(join(repo, "secrets/mounted.env"), join(repo, ".env"));
  const worktree = addWorktree(repo, "dangling");

  assert.equal(run(pluginEnv(repo, worktree)), 0);
  assert.equal(lstatSync(join(worktree, ".env")).isSymbolicLink(), true);
});

test("one unwritable entry fails on its own without abandoning the rest", () => {
  const repo = makeRepo({}, { gitignore: "blocked/\nkeep.local\n" });
  write(repo, "blocked/.env", "BLOCKED=1");
  write(repo, "keep.local", "KEPT=1");
  write(
    repo,
    ".herdr-worktree.toml",
    'auto_detect = false\ncopy = ["blocked/.env", "keep.local"]\nnotify = false',
  );
  const worktree = addWorktree(repo, "partial-failure");
  // A plain file where the copy needs a directory, so creating the parent throws.
  write(worktree, "blocked", "not a directory");

  assert.equal(run(pluginEnv(repo, worktree)), 1);
  assert.equal(read(worktree, "keep.local"), "KEPT=1");
});

test("seeds a missing file from its committed example only when asked", () => {
  const files = { "apps/api/.env.local.example": "API_KEY=replace-me" };
  const repo = makeRepo(files, { gitignore: ".env.local\n" });
  const untouched = addWorktree(repo, "no-seed");

  assert.equal(run(pluginEnv(repo, untouched)), 0);
  assert.equal(existsSync(join(untouched, "apps/api/.env.local")), false);

  write(repo, ".herdr-worktree.toml", "seed_from_example = true\nnotify = false");
  const seeded = addWorktree(repo, "seed");

  assert.equal(run(pluginEnv(repo, seeded)), 0);
  assert.equal(read(seeded, "apps/api/.env.local"), "API_KEY=replace-me");
});

test("refuses to run repository commands until the machine owner trusts the repo", () => {
  const marker = 'require("node:fs").writeFileSync("ran.txt", "yes");';
  const repo = makeRepo({ "setup-marker.cjs": marker });
  write(repo, ".herdr-worktree.toml", 'post_create = ["node setup-marker.cjs"]\nnotify = false');

  const blocked = addWorktree(repo, "untrusted");
  assert.equal(run(pluginEnv(repo, blocked, { HERDR_PLUGIN_CONFIG_DIR: configDirWith() })), 0);
  assert.equal(existsSync(join(blocked, "ran.txt")), false);

  const allowed = addWorktree(repo, "trusted");
  const env = pluginEnv(repo, allowed, { HERDR_PLUGIN_CONFIG_DIR: configDirWith(repo) });
  assert.equal(run(env), 0);
  assert.equal(read(allowed, "ran.txt"), "yes");
});

test("reports a failing setup command as a failed run", () => {
  const repo = makeRepo({ "fail.cjs": "process.exit(3);" });
  write(repo, ".herdr-worktree.toml", 'post_create = ["node fail.cjs"]\nnotify = false');
  const worktree = addWorktree(repo, "failing");

  const env = pluginEnv(repo, worktree, { HERDR_PLUGIN_CONFIG_DIR: configDirWith(repo) });
  assert.equal(run(env), 1);
});

test("fails loudly when Herdr passes no worktree at all", () => {
  assert.throws(() => run({}), /no worktree in HERDR_PLUGIN_CONTEXT_JSON/);
});

// `write-arg.cjs` records the single argument it is given, so a test can prove
// the branch name arrived as one literal argument instead of being re-parsed by
// the shell. Every branch below is a name `git check-ref-format` accepts.
const WRITE_ARG = 'require("node:fs").writeFileSync("arg.txt", process.argv[2] ?? "");';

function repoRunningWriteArg(command) {
  const repo = makeRepo({ "write-arg.cjs": WRITE_ARG });
  write(repo, ".herdr-worktree.toml", `post_create = ["${command}"]\nnotify = false`);
  return repo;
}

for (const branch of ["a;b", "a`b", "feat/50%", "a!b"]) {
  test(`a branch named ${branch} reaches the command verbatim`, () => {
    const repo = repoRunningWriteArg("node write-arg.cjs {{ branch }}");
    const worktree = addWorktree(repo, branch);
    const env = pluginEnv(repo, worktree, { HERDR_PLUGIN_CONFIG_DIR: configDirWith(repo) }, branch);

    // A non-zero run would mean the shell split the name and tried to run the
    // remainder, which is the injection the escaping exists to prevent.
    assert.equal(run(env), 0);
    assert.equal(read(worktree, "arg.txt"), branch);
  });
}

test("gives one branch the same port every time, and two branches two ports", () => {
  const repo = repoRunningWriteArg("node write-arg.cjs {{ branch | hash_port }}");
  const configDir = configDirWith(repo);

  const portFor = (branch) => {
    const worktree = addWorktree(repo, branch);
    const env = pluginEnv(repo, worktree, { HERDR_PLUGIN_CONFIG_DIR: configDir }, branch);
    assert.equal(run(env), 0);
    const first = read(worktree, "arg.txt");

    // The same branch again, so the port cannot drift between two runs of it.
    assert.equal(run(env), 0);
    assert.equal(read(worktree, "arg.txt"), first);
    return first;
  };

  assert.notEqual(portFor("feature/checkout"), portFor("release/1.0"));
});

test("fails the command instead of running it with an empty variable", () => {
  const repo = repoRunningWriteArg("node write-arg.cjs {{ branch }}");
  const worktree = addWorktree(repo, "detached");
  const env = pluginEnv(repo, worktree, { HERDR_PLUGIN_CONFIG_DIR: configDirWith(repo) }, null);

  assert.equal(run(env), 1);
  assert.equal(existsSync(join(worktree, "arg.txt")), false);
});

test("--dry-run prints the rendered command and touches nothing", () => {
  const repo = makeRepo({ "write-arg.cjs": WRITE_ARG }, { gitignore: ".env\nshared/\n" });
  write(repo, ".env", "FROM=main");
  write(repo, "shared/blob.bin", "big");
  write(
    repo,
    ".herdr-worktree.toml",
    [
      'symlink = ["shared"]',
      'post_create = ["node write-arg.cjs {{ branch | hash_port }}"]',
      "notify = false",
    ].join("\n"),
  );
  const worktree = addWorktree(repo, "dry");
  const env = pluginEnv(repo, worktree, { HERDR_PLUGIN_CONFIG_DIR: configDirWith(repo) }, "dry");

  const result = spawnSync(
    process.execPath,
    [join(import.meta.dirname, "../src/index.mjs"), "--dry-run"],
    {
      env: { ...process.env, ...env },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /would link shared/);
  assert.match(result.stdout, /would copy \.env/);
  assert.match(result.stdout, /would run +node write-arg\.cjs '\d{5}'/);

  assert.equal(existsSync(join(worktree, "arg.txt")), false);
  assert.equal(existsSync(join(worktree, ".env")), false);
  assert.equal(existsSync(join(worktree, "shared")), false);
});

test("--dry-run resolves the worktree from a path argument", () => {
  const repo = makeRepo({}, { gitignore: ".env\n" });
  write(repo, ".env", "FROM=main");
  const worktree = addWorktree(repo, "dry-argv");

  const result = spawnSync(
    process.execPath,
    [join(import.meta.dirname, "../src/index.mjs"), "--dry-run", worktree],
    {
      env: { ...process.env, HERDR_PLUGIN_CONTEXT_JSON: "", HERDR_PLUGIN_EVENT_JSON: "" },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /would copy \.env/);
  assert.equal(existsSync(join(worktree, ".env")), false);
});

test("a quoted argument in the command survives the shell", () => {
  const repo = makeRepo({ "write-arg.cjs": WRITE_ARG });
  write(
    repo,
    ".herdr-worktree.toml",
    ['post_create = ["node write-arg.cjs \\"a b\\""]', "notify = false"].join("\n"),
  );
  const worktree = addWorktree(repo, "quoted");

  // A shell handed the command as several arguments instead of one would give
  // write-arg.cjs only "a" here.
  assert.equal(run(pluginEnv(repo, worktree, { HERDR_PLUGIN_CONFIG_DIR: configDirWith(repo) })), 0);
  assert.equal(read(worktree, "arg.txt"), "a b");
});

test("a command that cannot be rendered stops the ones after it", () => {
  const repo = makeRepo({
    "write-arg.cjs": WRITE_ARG,
    "write-late.cjs": WRITE_ARG.replace("arg.txt", "late.txt"),
  });
  write(
    repo,
    ".herdr-worktree.toml",
    [
      'post_create = ["node write-arg.cjs {{ branch }}", "echo {{ brunch }}", "node write-late.cjs x"]',
      "notify = false",
    ].join("\n"),
  );
  const worktree = addWorktree(repo, "halting");

  assert.equal(run(pluginEnv(repo, worktree, { HERDR_PLUGIN_CONFIG_DIR: configDirWith(repo) })), 1);
  assert.equal(read(worktree, "arg.txt"), "feature");
  assert.equal(existsSync(join(worktree, "late.txt")), false);
});

test("the report names the command that ran, not the template it came from", () => {
  const repo = makeRepo({ "write-arg.cjs": WRITE_ARG });
  const worktree = addWorktree(repo, "reported");
  const vars = worktreeVariables({
    worktreePath: worktree,
    repoRoot: repo,
    branch: "feature/checkout",
  });

  const results = runPostCreate(worktree, ["node write-arg.cjs {{ branch | hash_port }}"], {
    timeoutMs: 60000,
    configDir: configDirWith(repo),
    repoRoot: repo,
    env: {},
    vars,
  });

  assert.deepEqual(results, [
    {
      action: "post_create",
      path: "node write-arg.cjs '13706'",
      status: "done",
    },
  ]);
});
