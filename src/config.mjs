import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { isWithin } from "./apply.mjs";
import { DEFAULT_PATTERNS, toPosix } from "./detect.mjs";
import { parseToml } from "./toml.mjs";

export const CONFIG_FILENAME = ".herdr-worktree.toml";

// One row per key: what it accepts, what it is worth when absent, and whether
// it names paths inside the repository. Everything below reads this table, so
// adding a key is one edit rather than three that have to agree.
const KEYS = {
  auto_detect: { type: "boolean", default: true },
  patterns: { type: "string[]", default: DEFAULT_PATTERNS },
  copy: { type: "string[]", default: [], path: true },
  symlink: { type: "string[]", default: [], path: true },
  exclude: { type: "string[]", default: [] },
  seed_from_example: { type: "boolean", default: false },
  post_create: { type: "string[]", default: [] },
  post_create_timeout_ms: { type: "integer", default: 600000 },
  post_remove: { type: "string[]", default: [] },
  post_remove_timeout_ms: { type: "integer", default: 600000 },
  notify: { type: "boolean", default: true },
};

export const DEFAULTS = Object.fromEntries(
  Object.entries(KEYS).map(([key, spec]) => [key, spec.default]),
);

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

function checkType(key, value, type) {
  if (type === "boolean" && typeof value !== "boolean") {
    throw new ConfigError(`${key} must be true or false`);
  }
  if (type === "integer" && (!Number.isInteger(value) || value < 0)) {
    throw new ConfigError(`${key} must be a whole number of milliseconds`);
  }
  if (type === "string[]") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new ConfigError(`${key} must be an array of strings`);
    }
  }
}

// Entries name paths inside the repository. Anything absolute or climbing out
// of it is a mistake worth reporting rather than resolving. The POSIX spelling
// every caller wants is produced here, so no consumer has to convert again.
// The entry is named by its position and never quoted: the message reaches the
// log and the preview pane, and the value is whatever the repository wrote.
function checkPath(key, value, index) {
  const posix = toPosix(value);
  const entry = `${key} entry ${index + 1}`;
  if (posix === "" || posix.startsWith("/") || /^[A-Za-z]:/.test(posix)) {
    throw new ConfigError(`${entry} must be relative to the repository root`);
  }
  if (posix.split("/").includes("..")) {
    throw new ConfigError(`${entry} must stay inside the repository`);
  }
  return posix;
}

/** Validate a parsed config object and fill in every default. */
export function normalizeConfig(raw) {
  const unknown = Object.keys(raw).filter((key) => !Object.hasOwn(KEYS, key));
  if (unknown.length > 0) {
    throw new ConfigError(
      `unknown key(s): ${unknown.join(", ")}. Valid keys: ${Object.keys(KEYS).join(", ")}`,
    );
  }

  const config = { ...DEFAULTS, ...raw };

  for (const [key, spec] of Object.entries(KEYS)) {
    if (Object.hasOwn(raw, key)) checkType(key, raw[key], spec.type);
    if (spec.path) config[key] = config[key].map((entry, index) => checkPath(key, entry, index));
  }

  return config;
}

// A config is a few hundred bytes written by hand. The bound keeps a file that
// is not one, a log or a generated blob, from being read whole into memory.
export const MAX_CONFIG_BYTES = 64 * 1024;

// Refuses `O_NOFOLLOW` where the platform has it, so a link swapped in after
// the check below is not followed either. Windows has none, and the check is
// what holds there.
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

/**
 * The config file's text, or undefined when there is none. Only a regular file
 * inside the repository is read: a link could point at any file the user can
 * read, and a parse error quotes the line it stopped at, so a committed link to
 * a credentials file would print a credential into the log and the pane. A
 * device or a pipe could be read forever.
 */
function readConfigFile(repoRoot) {
  const path = join(repoRoot, CONFIG_FILENAME);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return undefined;

  if (stat.isSymbolicLink()) {
    throw new ConfigError(
      `${CONFIG_FILENAME} is a symbolic link; the config must be a regular file in the repository`,
    );
  }
  if (!stat.isFile()) throw new ConfigError(`${CONFIG_FILENAME} is not a regular file`);
  if (!isWithin(realpathSync.native(path), realpathSync.native(repoRoot))) {
    throw new ConfigError(`${CONFIG_FILENAME} resolves to a file outside the repository`);
  }

  const tooLarge = new ConfigError(
    `${CONFIG_FILENAME} is larger than ${MAX_CONFIG_BYTES / 1024} KiB, which no config needs`,
  );
  if (stat.size > MAX_CONFIG_BYTES) throw tooLarge;

  const fd = openSync(path, READ_FLAGS);
  try {
    if (!fstatSync(fd).isFile()) throw new ConfigError(`${CONFIG_FILENAME} is not a regular file`);
    // One byte past the bound tells a file that grew since the check from one
    // that fits exactly.
    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    let length = 0;
    let read;
    do {
      read = readSync(fd, buffer, length, buffer.length - length, null);
      length += read;
    } while (read > 0 && length < buffer.length);
    if (length > MAX_CONFIG_BYTES) throw tooLarge;
    return buffer.toString("utf8", 0, length);
  } finally {
    closeSync(fd);
  }
}

/**
 * Read `.herdr-worktree.toml` from the repository root. A repository without
 * one gets the defaults, which is what makes the plugin useful with no setup.
 */
export function loadConfig(repoRoot) {
  const source = readConfigFile(repoRoot);
  if (source === undefined) return { ...DEFAULTS, configured: false };
  return { ...normalizeConfig(parseToml(source)), configured: true };
}

export { ConfigError };
