---
title: atk project profile
status: APPROVED
owner: Lam Ngoc Khuong
approver: Lam Ngoc Khuong
created: 2026-09-21
updated: 2026-09-22
ticket: none
---

# atk project profile

Written by `/atk:init`. Read by the atk skills that need project facts. Committed on purpose: the
next person on the team inherits it. Re-check it with `/atk:init --audit`.

## Project

- Name: herdr-worktree-setup
- Repository: lamngockhuong/herdr-worktree-setup
- Shape: single repo  <!-- source: no pnpm-workspace.yaml, no workspaces key in package.json -->
- Package manager: pnpm 12.4.2  <!-- source: pnpm-lock.yaml; package.json packageManager -->

## Layers

| Layer | Directory | Standards | Reference module |
|-------|-----------|-----------|------------------|
| plugin | `src/` | `biome.json`, `.editorconfig` | `src/remove.mjs` with `test/remove.test.mjs` |

<!-- One layer: a Herdr plugin of plain ES modules, no build step, no dependencies. -->
<!-- No conventions document and no review checklist exist yet; the standards column is the
     linter and editor config, which are the only rules written down. -->

## Commands

| App or package | Test | Build | Lint | Extra |
|----------------|------|-------|------|-------|
| herdr-worktree-setup | `node --test` | none | `pnpm lint` | `pnpm check` runs lint then test |

- Setup: none

<!-- source: .github/workflows/ci.yml:31 (test), .github/workflows/ci.yml:41 (lint) -->
<!-- source: package.json scripts, which agree with CI. -->
<!-- Build is none: no build script in the manifest and no build job in CI. -->
<!-- Setup is none: package.json declares no dependencies or devDependencies, and `pnpm lint`
     fetches Biome through `pnpm dlx` on demand. -->
<!-- `pnpm lint` expands to `pnpm dlx @biomejs/biome@2.5.6 check .` and only reports; `pnpm
     lint:fix` is the writing form. -->

## Docs

- Docs root: `docs/`
- Conventions: `biome.json` and `.editorconfig`; no prose conventions document exists yet
- Review checklist: none yet  <!-- no document in docs/ carries one -->
- Designs: none
- Agent instructions: none  <!-- no CLAUDE.md, no AGENTS.md at the repository root -->

<!-- Documentation is bilingual in pairs: README.md / README.vi.md and docs/recipes.md /
     docs/recipes.vi.md. test/docs.test.mjs parses every TOML block in all four, so a
     documentation change that breaks an example fails the suite. -->
<!-- plans/ is git-ignored (.gitignore:4), so anything written there stays on one machine. -->

## Tracker

- Tracker: GitHub Issues  <!-- source: git remote origin; package.json bugs -->
- Repository owner: lamngockhuong
- Spec lives in: TBD (ask Lam Ngoc Khuong) — requirements are not written down anywhere today

## Team

| Role | Name | Host identifier | Approves |
|------|------|-----------------|----------|
| PM / Tech Lead / Dev / QA | Lam Ngoc Khuong | @lamngockhuong | everything, this profile included |

- Working language: English first, then a Vietnamese mirror where the project already keeps one
  (`README.vi.md`, `docs/recipes.vi.md`)

<!-- A solo project: every role maps onto one person. The BrSE and SRE rows are deleted rather
     than filled, because the project has neither. -->

## Verify

- Start: no application to start; this repository ships a Herdr plugin. The local exercise is
  `node src/index.mjs --dry-run <path to a git worktree>`, the same preview the plugin's `dry-run`
  action renders  <!-- source: src/index.mjs:71, src/context.mjs:98; herdr-plugin.toml actions -->
- Ready when: `pnpm check` exits zero, and the dry run prints the worktree, the repository, the
  branch, and the line `dry run: nothing is linked, copied, seeded or executed`
- Logs: none; the suite and the dry run both write to stdout
- Data check: re-run `node src/index.mjs --dry-run <repo>` after a change and compare the printed
  plan; the dry run changes nothing, so it is safe to repeat
- Cleanup: none for the dry run. The test suite creates real repositories and worktrees under the
  system temp directory and removes them itself
- Local only: the dry run and the suite only ever touch the path given to them and the system temp
  directory; the plugin reaches nothing over the network

<!-- `node src/preview.mjs` is the action wrapper rather than the preview: it asks the Herdr CLI
     to open a pane, and only falls back to printing when there is no Herdr to answer. -->
