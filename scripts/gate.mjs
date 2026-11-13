// Gate runner: one command, one small report. Plain node, no shell.
//   node scripts/gate.mjs verify build db [--keep-going]
// Steps run in the order given and stop at the first failure unless --keep-going.
// Writes .gates/report.json (git-ignored) and prints the same compact text. Exit 1 if any step failed, 2 on bad usage.
// `node scripts/gate.mjs --tree` prints "<commit> <tree>" for the checkout now; a report is current if both match.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = join(import.meta.dirname, '..')
const npmCli =
  process.env.npm_execpath?.endsWith('npm-cli.js') === true
    ? process.env.npm_execpath
    : join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')

/** Step name -> argv for `node`. */
export const STEPS = {
  verify: [npmCli, 'run', 'verify'],
  build: [npmCli, 'run', 'build'],
  db: [npmCli, 'run', 'test:db'],
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g')

/** The node:test totals of a step's output ("tests N, pass N, fail N", with or without the ℹ prefix), else the exit code. */
export function summarize(output, code) {
  const stripped = output
    .replace(ANSI, '')
    .split(/\r?\n/)
    .map((l) => {
      const s = l.trim()
      return s.startsWith('ℹ') ? s.slice(1).trim() : s.startsWith('# ') ? s.slice(2) : s
    })
  const total = (key) => {
    const l = stripped.findLast((s) => s.startsWith(key + ' ') && /^[0-9]+$/.test(s.slice(key.length + 1)))
    return l ?? ''
  }
  const totals = ['tests', 'pass', 'fail'].map(total)
  return totals.every(Boolean) ? totals.join(', ') : `exit ${code}`
}

/** First 12 hex of sha1 over the diff text and each untracked file's path and bytes, sorted by path. */
export function fingerprint(diff, untracked) {
  const hash = createHash('sha1').update(diff)
  for (const { path, data } of [...untracked].sort((a, b) => (a.path < b.path ? -1 : 1)))
    hash.update('\0').update(path).update('\0').update(data)
  return hash.digest('hex').slice(0, 12)
}

const tree = () => {
  const paths = git('ls-files', '-z', '--others', '--exclude-standard').split('\0').filter(Boolean)
  const untracked = paths.map((path) => {
    try {
      return { path, data: readFileSync(join(ROOT, path)) }
    } catch {
      return { path, data: '' } // unreadable (e.g. a directory entry): the name still counts
    }
  })
  return fingerprint(git('diff', 'HEAD'), untracked)
}

function git(...args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : ''
}

export function runStep(name) {
  const started = Date.now()
  const r = spawnSync(process.execPath, STEPS[name], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0' },
  })
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`
  const ok = r.status === 0
  return {
    step: { name, ok, ms: Date.now() - started, summary: summarize(output, r.status ?? 'spawn') },
    tail: ok
      ? null
      : output
          .replace(ANSI, '')
          .split(/\r?\n/)
          .filter((l) => l.trim())
          .slice(-20),
  }
}

function main(argv) {
  const keepGoing = argv.includes('--keep-going')
  const flags = argv.filter((a) => a.startsWith('--'))
  if (flags.includes('--tree')) {
    process.stdout.write(`${git('rev-parse', '--short', 'HEAD')} ${tree()}\n`)
    return 0
  }
  const badFlag = flags.filter((f) => f !== '--keep-going')
  const given = argv.filter((a) => !a.startsWith('--'))
  const unknown = given.filter((n) => !(n in STEPS))
  if (given.length === 0 || unknown.length || badFlag.length) {
    process.stderr.write(
      `usage: gate.mjs <${Object.keys(STEPS).join('|')}>... [--keep-going] | --tree\n`,
    )
    return 2
  }
  const names = given
  const steps = []
  const failures = []
  for (const name of names) {
    const { step, tail } = runStep(name)
    steps.push(step)
    if (tail) failures.push({ name, tail })
    if (!step.ok && !keepGoing) break
  }
  const report = {
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    commit: git('rev-parse', '--short', 'HEAD'),
    tree: tree(),
    dirty: git('status', '--porcelain') !== '',
    at: new Date().toISOString(),
    steps,
    failures,
  }
  mkdirSync(join(ROOT, '.gates'), { recursive: true })
  writeFileSync(join(ROOT, '.gates', 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  const out = (t) => process.stdout.write(`${t}\n`)
  out(`${report.branch} @ ${report.commit} tree ${report.tree}${report.dirty ? ' (dirty)' : ''}`)
  for (const s of steps)
    out(`${s.ok ? 'PASS' : 'FAIL'} ${s.name} ${(s.ms / 1000).toFixed(1)}s  ${s.summary}`)
  for (const f of failures) out(`\n--- ${f.name} (last lines) ---\n${f.tail.join('\n')}`)
  return steps.every((s) => s.ok) ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2))
}
