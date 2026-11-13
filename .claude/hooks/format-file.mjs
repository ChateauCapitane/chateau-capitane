// PostToolUse hook for Edit|Write: lint and auto-fix only the file that was just written, and show
// Claude whatever ESLint could not fix. Exit 2 puts stderr in front of Claude; exit 0 is silent.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

const CHECKED = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])
const ESLINT = join(process.cwd(), 'node_modules', 'eslint', 'bin', 'eslint.js')

let file
try {
  file = JSON.parse(readFileSync(0, 'utf8')).tool_input?.file_path
} catch {
  process.exit(0) // a payload we cannot read must never block an edit
}
if (typeof file !== 'string' || !CHECKED.has(extname(file).toLowerCase())) process.exit(0)

const path = resolve(file)
if (!existsSync(path) || !existsSync(ESLINT)) process.exit(0)

const result = spawnSync(
  process.execPath,
  [ESLINT, '--fix', path],
  { encoding: 'utf8', timeout: 25_000, env: { ...process.env, NO_COLOR: '1' } },
)
// A timeout or a crash is not a lint finding: stay quiet rather than nag.
if (result.status === 0 || result.status === null) process.exit(0)

const report = `${result.stdout}${result.stderr}`.trim().split('\n').slice(0, 40).join('\n')
process.stderr.write(`ESLint found problems it could not fix in ${file}:\n${report}\n`)
process.exit(2)
