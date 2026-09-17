# Changelog

## [0.2.0](https://github.com/lamngockhuong/herdr-worktree-setup/compare/v0.1.0...v0.2.0) (2026-09-17)


### ⚠ BREAKING CHANGES

* **post-create:** on Windows, post_create commands now run through powershell.exe -NoProfile -NonInteractive -Command instead of cmd.exe. A single-quoted PowerShell string is literal, which is what makes the escaping complete and means no branch name has to be refused for containing % or !. Commands written in cmd syntax may stop working: && and || are syntax errors in Windows PowerShell 5.1, and cmd built-ins such as set, copy and del are gone. A failed command is also now reported as exit code 1 whatever it actually exited with, because PowerShell forwards only its own exit status.

### Features

* **post-create:** template variables in setup commands ([#6](https://github.com/lamngockhuong/herdr-worktree-setup/issues/6)) ([2f3408c](https://github.com/lamngockhuong/herdr-worktree-setup/commit/2f3408ce7baae71153a97aab3e2776796d621b05))

## 0.1.0 (2026-09-15)

The first release, published before this repository kept a changelog. Recorded
here from the commit history so the file does not start mid-story.

### Features

* prepare new Herdr worktrees from detected and declared config ([ac8b56d](https://github.com/lamngockhuong/herdr-worktree-setup/commit/ac8b56d))
* add an action that writes a starter config into a repository ([7d5100f](https://github.com/lamngockhuong/herdr-worktree-setup/commit/7d5100f))

### Bug Fixes

* match a trusted repository however its path is spelled ([32f4ab8](https://github.com/lamngockhuong/herdr-worktree-setup/commit/32f4ab8))
* stop detection from dropping files it should have found ([0aac5ec](https://github.com/lamngockhuong/herdr-worktree-setup/commit/0aac5ec))
* link a directory before copying files into it ([ce56cfb](https://github.com/lamngockhuong/herdr-worktree-setup/commit/ce56cfb))
* read config keys as own properties only ([ab74cd0](https://github.com/lamngockhuong/herdr-worktree-setup/commit/ab74cd0))
