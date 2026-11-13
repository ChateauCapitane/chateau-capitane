#!/usr/bin/env node
/**
 * PreToolUse guard for the read-only reviewer subagents
 * (code-reviewer, security-auditor, ui-reviewer).
 *
 * Those agents already have Write/Edit/NotebookEdit removed at the tool level,
 * which is the hard control. Bash is the remaining hole: a shell can mutate the
 * repo through redirection, rm, git writes, or a package install. This blocks
 * that class of command.
 *
 * It is a denylist, so it is best-effort by nature — it is the innermost of
 * several layers, not the only one. Build and test commands are allowed on
 * purpose: reviewers must be able to run verification, and those write only to
 * gitignored output directories.
 *
 * Contract: reads the PreToolUse JSON payload on stdin. Exit 0 allows, exit 2
 * blocks and returns the stderr text to the agent.
 */

import { readFileSync } from 'node:fs'

// git's own subcommand rule: a global flag (-C, -c, --git-dir, ...) can sit
// between `git` and the subcommand, so a plain `\bgit\s+(commit|push|...)\b`
// regex misses `git -C . reset --hard` or `git -c user.name=x commit -m y`.
// This walks the actual token list the way git itself does. Found live: both
// forms above passed the previous regex uncaught.
const GIT_FLAGS_TAKING_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
])
const GIT_DANGEROUS_SUBCOMMANDS = new Set([
  'commit',
  'push',
  'add',
  'stage',
  'reset',
  'rebase',
  'merge',
  'cherry-pick',
  'revert',
  'stash',
  'tag',
  'restore',
  'clean',
  'am',
  'apply',
  'mv',
  'rm',
  'config',
])
// `git branch` itself is read-only (lists, or creates a new branch without
// switching to it) — only a delete is a mutation. Found live: `branch` was
// absent from the subcommand list entirely, so `git branch -D old` passed.
const GIT_BRANCH_DELETE_FLAGS = new Set(['-d', '-D', '--delete'])

// A chained command (`git status && git commit -m x`) puts more than one
// invocation in the same string. Found live, by review: the first version of
// this function found the FIRST `git` occurrence, then returned false the
// instant the token right after it wasn't a recognized flag/subcommand/
// `branch` — so it silently gave up on the rest of the string instead of
// looking for a later, real `git commit` past a leading no-op. Splitting on
// shell separators first, and running the same per-invocation check on each
// piece independently, means a mismatch in one piece no longer swallows the
// pieces after it.
const SHELL_SEPARATORS = /&&|\|\||;|\r\n|\n|\||&/g

// Textual, not syntactic: this matches the literal substring "git" wherever
// it appears, including inside a quoted string with no real invocation
// (`echo "please run git commit later"` blocks). That is a false positive,
// not a bypass — it over-blocks rather than under-blocks, the safe direction
// for a denylist — and predates this function (the single regex it replaced
// had the same literal-substring behavior). Left as is on purpose.
function segmentIsDangerousGitInvocation(segment) {
  const gitIdx = segment.search(/\bgit\b/i)
  if (gitIdx === -1) return false
  const tokens = segment.slice(gitIdx).match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.startsWith('-')) {
      const flagName = token.includes('=') ? token.slice(0, token.indexOf('=')) : token
      if (!token.includes('=') && GIT_FLAGS_TAKING_VALUE.has(flagName)) i++
      continue
    }
    const sub = token.toLowerCase()
    if (GIT_DANGEROUS_SUBCOMMANDS.has(sub)) return true
    if (sub === 'branch') {
      return tokens
        .slice(i + 1)
        .some((t) => GIT_BRANCH_DELETE_FLAGS.has(t) || /^-[a-zA-Z]*[dD]/.test(t))
    }
    return false
  }
  return false
}

function gitInvocationIsDangerous(command) {
  return command.split(SHELL_SEPARATORS).some(segmentIsDangerousGitInvocation)
}

const BLOCKED = [
  // --- git writes -------------------------------------------------------
  [gitInvocationIsDangerous, 'git write operation'],
  // `checkout` alone isn't dangerous (`checkout main`, `checkout -b x`) —
  // only discarding working-tree changes is. Broadened past `--` alone:
  // found live, `git checkout .` (no `--`) and a bare path both discard
  // changes just as `checkout --` does, and neither matched the old pattern.
  [/\bgit\s+checkout\s+(--(\s|$)|\.(\s|$)|\.\/|\/)/i, 'git checkout discards working-tree changes'],

  // --- filesystem mutation ---------------------------------------------
  [
    /(^|[;&|]\s*)(rm|rmdir|mv|cp|mkdir|touch|chmod|chown|ln|dd|truncate)\s/i,
    'filesystem mutation command',
  ],
  // A shell `rm` is caught above; a reviewer's own scratch script calling
  // fs.rmSync/unlinkSync (etc.) internally is not, since the mutation never
  // appears in the command string the hook can see — only `node -e`/`node
  // --eval` (or python -c/-m) inline code does, which this blocks. A
  // reviewer that writes the same call into a script *file* and runs it
  // with a bare `node file.mjs` is still invisible to a denylist like this
  // one; that gap is structural, not closed by this line (found live:
  // core-zoom.png, untracked and pre-existing, was deleted this way).
  [
    /\b(node|python3?)\s+(-e|--eval|-c)\s/i,
    'inline script execution (can mutate files a text-based command scan cannot see)',
  ],
  [
    /\b(Remove-Item|New-Item|Move-Item|Copy-Item|Rename-Item|Set-Content|Add-Content|Out-File|Set-ItemProperty|New-ItemProperty|Clear-Content)\b/i,
    'PowerShell filesystem mutation',
  ],

  // --- shell redirection into files ------------------------------------
  // Found live: the old pattern excluded any `>` preceded by a digit, meant
  // to allow `2>&1`-style fd-dups — but that also let a real write through
  // whenever the redirected fd happened to be spelled out, e.g. `2> file.txt`
  // or `1>file.txt`. An fd-dup is specifically `>&` (or `&>`, bash's
  // combined-stream form); anything else writes to a file regardless of
  // what digit (if any) precedes it.
  [/>{1,2}(?!&)\s*[^&|\s]/, 'shell redirection writes to a file'],
  [/&>\s*[^&|\s]/, 'shell &> redirection writes to a file'],
  // Found live, by review: `>&word` is only a safe fd-dup when `word` is a
  // digit (`>&2`) or `-` (closes the fd) — bash treats `>&` followed by
  // anything else as equivalent to `&>word`, a real file write. The `&>`
  // pattern above catches that spelling; this catches the same write spelled
  // the other way around (`>&outfile`, `>&file.txt`).
  [/>&(?!\s*(?:\d+|-)(?:[^\w]|$))/, 'shell >& redirection writes to a file'],
  [/\|\s*tee\b/i, 'tee writes to a file'],

  // --- in-place editors -------------------------------------------------
  // Found live: the previous version only matched `-i` as the flag
  // immediately following `sed`, so `sed --in-place ...` and `sed -e '...'
  // -i file` (a later, non-leading -i) both passed through uncaught. This
  // checks for an in-place flag anywhere after `sed`, in either spelling,
  // not a specific position in the argument list.
  [
    /\bsed\b(?=[\s\S]*(?:^|\s)(?:-[a-zA-Z]*i[a-zA-Z]*|--in-place)(?:[^a-zA-Z]|$))/i,
    'sed in-place edit',
  ],
  [/\bperl\s+.*-i/i, 'perl -i edits in place'],

  // --- dependency / environment mutation --------------------------------
  [
    /\b(npm|pnpm|yarn|bun)\s+(i|install|ci|add|remove|uninstall|update|upgrade|link|publish|dedupe|prune)\b/i,
    'package manager mutation',
  ],
  [/\bnpx\s+(-y\s+)?(create-|@?[\w@/-]*\bcreate\b)/i, 'scaffolding command'],

  // --- formatters / fixers that rewrite source --------------------------
  [/--write\b/i, 'a --write flag rewrites files'],
  [/--fix\b/i, 'a --fix flag rewrites files'],
  [/\bnpm\s+run\s+\S*(fix|format)\b/i, 'script rewrites files'],
  [/\bbiome\s+(format|check)\b(?!.*--dry-run)(?=.*--write)/i, 'biome write'],

  // --- model / service state --------------------------------------------

  // --- downloads to disk -------------------------------------------------
  [/\bcurl\b[^|]*\s-[a-zA-Z]*[oO]\b/i, 'curl writes to a file'],
  [/\b(wget|Invoke-WebRequest|iwr)\b.*(-OutFile|-O\b)/i, 'download writes to a file'],
]

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

const raw = readStdin()
let payload = {}
try {
  payload = JSON.parse(raw || '{}')
} catch {
  // A payload we cannot parse is not evidence of safety.
  process.stderr.write('readonly-guard: could not parse hook payload; blocking.\n')
  process.exit(2)
}

const input = payload.tool_input ?? payload.toolInput ?? {}
const command = String(input.command ?? '')

if (!command.trim()) process.exit(0)

for (const [pattern, reason] of BLOCKED) {
  const matched = typeof pattern === 'function' ? pattern(command) : pattern.test(command)
  if (matched) {
    process.stderr.write(
      `Blocked: ${reason}.\n` +
        'You are a read-only reviewer. Report this as a finding with the command ' +
        'you would have run and why — do not attempt to change the project.\n',
    )
    process.exit(2)
  }
}

process.exit(0)
