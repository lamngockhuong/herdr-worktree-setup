import { basename } from "node:path";

/** Anything wrong with a `{{ ... }}` expression: the name, the filter, or the braces. */
class TemplateError extends Error {
  constructor(message) {
    super(message);
    this.name = "TemplateError";
  }
}

// A 32-bit FNV-1a digest over the UTF-8 bytes. Both `hash` and `hash_port` are
// built from it, which makes it a compatibility surface: changing it moves
// every user's ports and container names. test/template.test.mjs pins the
// outputs to literal values, and changing one of them is a breaking change.
function fnv1a(value) {
  let digest = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    digest ^= byte;
    digest = Math.imul(digest, 0x01000193) >>> 0;
  }
  return digest;
}

export const FILTERS = {
  // `/` is legal in a branch name and illegal in a container or directory name.
  sanitize: (value) => value.replaceAll("/", "-").replaceAll("\\", "-"),
  // Three base36 characters: enough to keep branches apart, short enough to sit
  // in a name somebody still has to read.
  hash: (value) => (fnv1a(value) % 46656).toString(36).padStart(3, "0"),
  // 10000-19999: above the well-known ports, below the ephemeral range Linux
  // hands out by default, so a claimed port is not taken from under the branch.
  hash_port: (value) => String(10000 + (fnv1a(value) % 10000)),
};

/** The variables every `post_create` entry can use, from the hook's own context. */
export function worktreeVariables({ worktreePath, repoRoot, branch }) {
  return {
    branch: branch ?? null,
    worktree_path: worktreePath,
    worktree_name: basename(worktreePath),
    repo_path: repoRoot,
    repo_name: basename(repoRoot),
  };
}

/**
 * Quote a value so the shell hands the command one literal argument.
 * `git check-ref-format` accepts `a;b`, `a$(x)`, `` a`b` ``, `a&b` and `a'b` as
 * branch names, so substituting one raw into a shell command would turn naming
 * a branch into running code.
 */
export function shellEscape(value, platform = process.platform) {
  // A single-quoted PowerShell string is literal — no escape sequences, no `%`
  // expansion, no delayed `!` expansion — and doubling `'` closes nothing.
  if (platform === "win32") return `'${value.replaceAll("'", "''")}'`;
  // POSIX single quotes end at the first `'`, so close, escape, and reopen.
  return `'${value.replaceAll("'", "'\\''")}'`;
}

// What counts as a placeholder: a variable name, optionally through filters.
// Anything else between the braces is the author's own text — `{{.Names}}` in a
// `docker --format` string, a Go or Helm template — and passes through
// untouched, so a command that worked before templating keeps working. A chain
// of filters matches deliberately, so `substitute` can refuse it by name
// instead of leaving it to render as literal braces.
const PLACEHOLDER = /^\s*[a-z_][a-z0-9_]*\s*(\|\s*[a-z_][a-z0-9_]*\s*)*$/;

// The Go template actions that stand alone and so are shaped like a variable
// name. Every other one — `if`, `range`, `with`, `define` — carries an argument
// and fails the pattern above on its own.
const FOREIGN_KEYWORDS = new Set(["end", "else", "break", "continue"]);

function substitute(expression, vars, platform) {
  const parts = expression.split("|");
  if (parts.length > 2) {
    throw new TemplateError(`{{${expression}}} chains filters; only one filter is supported`);
  }

  const name = parts[0].trim();
  if (!Object.hasOwn(vars, name)) {
    throw new TemplateError(
      `unknown variable "${name}". Known variables: ${Object.keys(vars).join(", ")}`,
    );
  }

  // Rendering nothing would build a command around a missing port, which fails
  // later and somewhere far less obvious than here.
  const value = vars[name];
  if (value === null || value === undefined || value === "") {
    // `branch` is the only variable that can exist and still hold nothing.
    const reason =
      name === "branch"
        ? "the worktree has no branch checked out"
        : "nothing in this run supplies it";
    throw new TemplateError(`"${name}" has no value here: ${reason}`);
  }

  const filterName = parts[1]?.trim();
  if (filterName === undefined) return shellEscape(value, platform);

  const filter = FILTERS[filterName];
  if (!filter) {
    throw new TemplateError(
      `unknown filter "${filterName}". Known filters: ${Object.keys(FILTERS).join(", ")}`,
    );
  }
  return shellEscape(filter(value), platform);
}

/**
 * Substitute `{{ name }}` and `{{ name | filter }}` in one command. Only the
 * substituted values are escaped; the surrounding text is the author's own and
 * is left exactly as written.
 */
export function render(text, vars, platform = process.platform) {
  let out = "";
  let index = 0;

  for (;;) {
    const open = text.indexOf("{{", index);
    if (open === -1) return out + text.slice(index);

    const close = text.indexOf("}}", open + 2);
    if (close === -1) throw new TemplateError(`unterminated {{ in: ${text}`);

    const expression = text.slice(open + 2, close);
    out += text.slice(index, open);
    const claimed = PLACEHOLDER.test(expression) && !FOREIGN_KEYWORDS.has(expression.trim());
    out += claimed ? substitute(expression, vars, platform) : `{{${expression}}}`;
    index = close + 2;
  }
}

export { TemplateError };
