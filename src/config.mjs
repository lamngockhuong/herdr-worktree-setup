import { readFileSync } from "node:fs";
import { join } from "node:path";
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
function checkPath(key, value) {
  const posix = toPosix(value);
  if (posix === "" || posix.startsWith("/") || /^[A-Za-z]:/.test(posix)) {
    throw new ConfigError(`${key} entry must be relative to the repository root: ${value}`);
  }
  if (posix.split("/").includes("..")) {
    throw new ConfigError(`${key} entry must stay inside the repository: ${value}`);
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
    if (spec.path) config[key] = config[key].map((entry) => checkPath(key, entry));
  }

  return config;
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
