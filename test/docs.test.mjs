import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { normalizeConfig } from "../src/config.mjs";
import { render, worktreeVariables } from "../src/template.mjs";
import { parseToml } from "../src/toml.mjs";

// Every configuration the documentation shows is a promise, and a reader who
// pastes one and gets an error was told something untrue. The generated
// template is held to this in init.test.mjs; these are the hand-written ones.
const DOCS = ["README.md", "README.vi.md", "docs/recipes.md", "docs/recipes.vi.md"];

const ROOT = join(import.meta.dirname, "..");

const tomlBlocks = (file) => [
  ...readFileSync(join(ROOT, file), "utf8").matchAll(/```toml\n([\s\S]*?)```/g),
];

// The values the README pins, so a documented command renders to the numbers
// the documentation claims for it.
const vars = worktreeVariables({
  worktreePath: "/repos/demo-feature-checkout",
  repoRoot: "/repos/demo",
  branch: "feature/checkout",
});

const assignsSomething = (block) => /^\s*[a-z_]+\s*=/m.test(block);

for (const file of DOCS) {
  test(`every config ${file} shows is one the plugin accepts`, () => {
    const blocks = tomlBlocks(file);
    // A renamed heading or a fenced block that lost its language would empty
    // this list and quietly stop checking the file.
    assert.ok(blocks.length > 0, `no toml blocks found in ${file}; has the file moved?`);

    for (const [index, [, block]] of blocks.entries()) {
      const where = `${file} toml block ${index + 1}`;

      // One block is the detection listing `init-config` writes above the keys,
      // which is commentary rather than configuration. It has to be all comment
      // for that to be true, or it is a config that failed to set anything.
      if (!assignsSomething(block)) {
        for (const line of block.split("\n")) assert.match(line, /^\s*(#.*)?$/, where);
        continue;
      }

      try {
        const config = normalizeConfig(parseToml(block));
        for (const command of [...config.post_create, ...config.post_remove]) {
          render(command, vars);
        }
      } catch (error) {
        assert.fail(`${where}: ${error.message}`);
      }
    }
  });
}
