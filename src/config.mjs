import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PATTERNS } from "./detect.mjs";
import { parseToml } from "./toml.mjs";

export const CONFIG_FILENAME = ".herdr-worktree.toml";

export const DEFAULTS = {
  auto_detect: true,
  patterns: DEFAULT_PATTERNS,
  copy: [],
  symlink: [],
  exclude: [],
  seed_from_example: false,
  post_create: [],
  post_create_timeout_ms: 600000,
  notify: true,
};

const SCHEMA = {
  auto_detect: "boolean",
  patterns: "string[]",
  copy: "string[]",
  symlink: "string[]",
  exclude: "string[]",
  seed_from_example: "boolean",
  post_create: "string[]",
  post_create_timeout_ms: "integer",
  notify: "boolean",
};

// Entries name paths inside the repository. Anything absolute or climbing out
// of it is a mistake worth reporting rather than resolving.
const PATH_KEYS = ["copy", "symlink"];

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

function checkPath(key, value) {
  const posix = value.replaceAll("\\", "/");
  if (posix === "" || posix.startsWith("/") || /^[A-Za-z]:/.test(posix)) {
    throw new ConfigError(`${key} entry must be relative to the repository root: ${value}`);
  }
  if (posix.split("/").includes("..")) {
    throw new ConfigError(`${key} entry must stay inside the repository: ${value}`);
  }
}

/** Validate a parsed config object and fill in every default. */
export function normalizeConfig(raw) {
  const unknown = Object.keys(raw).filter((key) => !(key in SCHEMA));
  if (unknown.length > 0) {
    throw new ConfigError(
      `unknown key(s): ${unknown.join(", ")}. Valid keys: ${Object.keys(SCHEMA).join(", ")}`,
    );
  }

  for (const [key, type] of Object.entries(SCHEMA)) {
    if (key in raw) checkType(key, raw[key], type);
  }

  for (const key of PATH_KEYS) {
    for (const entry of raw[key] ?? []) checkPath(key, entry);
  }

  return { ...DEFAULTS, ...raw };
}

/**
 * Read `.herdr-worktree.toml` from the repository root. A repository without
 * one gets the defaults, which is what makes the plugin useful with no setup.
 */
export function loadConfig(repoRoot) {
  let source;
  try {
    source = readFileSync(join(repoRoot, CONFIG_FILENAME), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { ...DEFAULTS, configured: false };
    throw error;
  }
  return { ...normalizeConfig(parseToml(source)), configured: true };
}

export { ConfigError };
