#!/usr/bin/env node
/**
 * Assert that the built npm tarball contains the artifacts the host and the
 * browser half resolve at runtime. This catches a missing/renamed tsdown entry
 * even when every unit test still passes against a test fixture.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const raw = execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['pack', '--dry-run', '--json'], {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
  shell: process.platform === 'win32',
})
const result = JSON.parse(raw)
const files = new Set((result.files ?? []).map(entry => entry.path))
const required = [
  'package.json',
  'cordis.patch.yml',
  'lib/index.js',
  'lib/client.js',
  'lib/local-direct-worker.js',
  'lib/wire-worker.js',
  'locale/en.json',
  'locale/zh.json',
]
const missing = required.filter(path => !files.has(path))
if (missing.length > 0) {
  console.error(`package: missing required artifact(s): ${missing.join(', ')}`)
  process.exitCode = 1
} else {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  console.log(`package: ${pkg.name}@${pkg.version} contains ${required.length} required artifacts`)
}
