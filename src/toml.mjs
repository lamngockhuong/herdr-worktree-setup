// Minimal TOML reader for `.herdr-worktree.toml`.
//
// Supported subset: comments, `[section]` headers, and `key = value` where the
// value is a boolean, an integer, a basic or literal string, or an array of
// those (single or multi line, trailing comma allowed).
//
// Anything outside the subset throws. A config file is small and hand written,
// so a loud error beats a typo that silently parses as "no value".

const BOOLEANS = { true: true, false: false };

const ESCAPES = {
  b: "\b",
  t: "\t",
  n: "\n",
  f: "\f",
  r: "\r",
  '"': '"',
  "\\": "\\",
};

class TomlError extends Error {
  constructor(message, line) {
    super(line === undefined ? message : `${message} (line ${line})`);
    this.name = "TomlError";
  }
}

// Cut a trailing `#` comment off a line without touching a `#` inside a string.
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#") {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseBasicString(raw, lineNo) {
  let out = "";
  for (let i = 1; i < raw.length - 1; i++) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[++i];
    if (next === "u" || next === "U") {
      const width = next === "u" ? 4 : 8;
      const hex = raw.slice(i + 1, i + 1 + width);
      if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== width) {
        throw new TomlError(`bad unicode escape \\${next}${hex}`, lineNo);
      }
      out += String.fromCodePoint(Number.parseInt(hex, 16));
      i += width;
      continue;
    }
    if (!(next in ESCAPES)) throw new TomlError(`unknown escape \\${next}`, lineNo);
    out += ESCAPES[next];
  }
  return out;
}

// Split the inside of an array on commas that sit outside any string.
function splitArrayItems(body, lineNo) {
  const items = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[") depth++;
    else if (ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      items.push(body.slice(start, i));
      start = i + 1;
    }
  }
  if (quote) throw new TomlError("unterminated string in array", lineNo);
  items.push(body.slice(start));
  return items.map((item) => item.trim()).filter((item) => item !== "");
}

function parseValue(raw, lineNo) {
  const text = raw.trim();
  if (text === "") throw new TomlError("missing value", lineNo);

  if (text in BOOLEANS) return BOOLEANS[text];

  if (text.startsWith("[")) {
    if (!text.endsWith("]")) throw new TomlError("unterminated array", lineNo);
    return splitArrayItems(text.slice(1, -1), lineNo).map((item) => parseValue(item, lineNo));
  }

  if (text.startsWith('"')) {
    if (text.length < 2 || !text.endsWith('"')) {
      throw new TomlError("unterminated string", lineNo);
    }
    return parseBasicString(text, lineNo);
  }

  if (text.startsWith("'")) {
    if (text.length < 2 || !text.endsWith("'")) {
      throw new TomlError("unterminated string", lineNo);
    }
    return text.slice(1, -1);
  }

  if (/^[+-]?\d+(_\d+)*$/.test(text)) {
    return Number.parseInt(text.replaceAll("_", ""), 10);
  }

  throw new TomlError(`unsupported value: ${text}`, lineNo);
}

// True while an array literal is still open, so the reader keeps joining lines.
function isIncomplete(text) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[") depth++;
    else if (ch === "]") depth--;
  }
  return depth > 0;
}

/**
 * Parse the supported TOML subset into a plain object. Section headers nest one
 * level: `[tool]` puts later keys under `result.tool`.
 */
export function parseToml(source) {
  const root = {};
  let table = root;
  const lines = source.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = stripComment(lines[i]).trim();
    if (line === "") continue;

    if (line.startsWith("[")) {
      const match = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
      if (!match) throw new TomlError(`unsupported section header: ${line}`, lineNo);
      table = {};
      root[match[1]] = table;
      continue;
    }

    const eq = line.indexOf("=");
    if (eq === -1) throw new TomlError(`expected key = value: ${line}`, lineNo);

    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new TomlError(`unsupported key: ${key}`, lineNo);
    if (key in table) throw new TomlError(`duplicate key: ${key}`, lineNo);

    let rest = line.slice(eq + 1).trim();
    while (isIncomplete(rest)) {
      i++;
      if (i >= lines.length) throw new TomlError("unterminated array", lineNo);
      rest += `\n${stripComment(lines[i]).trim()}`;
    }

    table[key] = parseValue(rest, lineNo);
  }

  return root;
}

export { TomlError };
