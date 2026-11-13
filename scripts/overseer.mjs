// Overseer: a deterministic, zero-token check that a slice is not being over-worked or repeated.
// Read-only: git queries and file reads only, never a write. Plain node.
//   node scripts/overseer.mjs               one line per worktree: size vs budget
//   node scripts/overseer.mjs done <word>…  what the repo already holds on a topic
// Exit 3 = a measurement was unavailable (e.g. node may not spawn git in a sandbox). Never read that as "within budget".
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// SteamRoller calibration (last 40 merged slices, 2026-10-08: median 600 inserted lines, p90 ~3200).
// Recalibrate for this repo after about 10 merged slices here.
// Commit age is not usable: slices are committed once, at the end.
const LINES_WARN = 1500
const LINES_STOP = 3500

let unavailable = ''
const git = (cwd, ...args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  } catch (e) {
    unavailable ||= `git ${args[0]}: ${e.code ?? e.message}`
    return ''
  }
}
const lineCount = (file) => {
  try {
    return (readFileSync(file, 'utf8').match(/\n/g) ?? []).length
  } catch {
    return 0
  }
}
const [cmd, ...words] = process.argv.slice(2)
const top = git(process.cwd(), 'rev-parse', '--show-toplevel')
if (!top) {
  process.stdout.write(`UNAVAILABLE (${unavailable || 'not a git repository'}): run git directly\n`)
  process.exit(3)
}

if (cmd === 'done') {
  for (const w of words) {
    // A hit proves the topic was discussed or changed; [src] means code under src/ was touched.
    const hits = git(top, 'log', 'main', '-i', '--format=%h %s', '-n', '5', `--grep=${w}`)
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const files = git(top, 'show', '--name-only', '--format=', l.split(' ')[0])
        return `  ${files.includes('src/') ? '[src]' : '[docs only]'} ${l}`
      })
    const docs = ['docs/decisions', 'docs/tasks'].flatMap((d) =>
      existsSync(join(top, d))
        ? readdirSync(join(top, d)).filter((f) => f.toLowerCase().includes(w.toLowerCase()))
        : [],
    )
    const next = readFileSync(join(top, 'docs/NEXT.md'), 'utf8')
      .split('\n')
      .filter((l) => l.toLowerCase().includes(w.toLowerCase()))
      .slice(0, 3)
    process.stdout.write(
      `== ${w}\ncommits:\n${hits.join('\n') || '  none'}\ndocs: ${docs.join(', ') || 'none'}\nNEXT.md:\n${next.join('\n') || '  none'}\n`,
    )
  }
  process.exit(unavailable ? 3 : 0)
}

const trees = git(top, 'worktree', 'list', '--porcelain')
  .split('\n')
  .filter((l) => l.startsWith('worktree '))
  .map((l) => l.slice(9))
for (const dir of trees) {
  const branch = git(dir, 'branch', '--show-current') || '(detached)'
  const ahead = git(dir, 'rev-list', '--count', 'main..HEAD') || '0'
  const stat = git(dir, 'diff', '--shortstat', git(dir, 'merge-base', 'main', 'HEAD') || 'main')
  const tracked = [...stat.matchAll(/(\d+) (?:insertion|deletion)/g)].reduce(
    (n, m) => n + Number(m[1]),
    0,
  )
  // New files are invisible to git diff; count their lines.
  const fresh = git(dir, 'ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)
  const lines = tracked + fresh.reduce((n, f) => n + lineCount(join(dir, f)), 0)
  const flags = []
  if (lines > LINES_STOP) flags.push(`OVER BUDGET (>${LINES_STOP} lines): ship what works or split`)
  else if (lines > LINES_WARN) flags.push(`large (>${LINES_WARN} lines)`)
  process.stdout.write(
    `${branch}: ${ahead} commits ahead of main, ${lines} changed lines (${fresh.length} new files), ${flags.length ? `-> ${flags.join('; ')}` : '-> within budget'}\n`,
  )
}
if (unavailable) {
  process.stdout.write(
    `UNAVAILABLE (${unavailable}): figures above are partial; run git directly\n`,
  )
  process.exit(3)
}
