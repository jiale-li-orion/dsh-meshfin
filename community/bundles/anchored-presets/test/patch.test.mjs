/**
 * The bundle patch: parsed by the real overlay parser, converted as documented,
 * and in sync with the generator.
 *
 * This also checks every declared plugin name against the source checkout's
 * `packages/` tree when one is present, which is where a renamed upstream
 * package shows up first. An installed bundle has no checkout; that check then
 * reports itself as skipped.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import AgentPreset from '@deepseek-ai/dsh-agent-preset'
import { renderPatch } from '../scripts/build-patch.mjs'

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
const patchFile = join(packageDir, 'cordis.patch.yml')
const helpersDir = join(packageDir, 'helpers')

/** Upstream rename this port applies; the old row name must not survive. */
const RETIRED_ROWS = ['@deepseek-ai/dsh-workflow-worker-thread']

/** Rows whose config fields the 0.2.1 preset composition removed. */
const RETIRED_SUBAGENT_FIELDS = ['backgroundMode', 'enableRunInBackground']

const composed = () => composeEntries([loadOverlayPatches('dsh', patchFile)])

test('the checked-in patch matches the generator', () => {
  assert.equal(readFileSync(patchFile, 'utf8'), renderPatch())
})

test('declares seven presets with declaration rows the Loader can compose', () => {
  const rows = composed()
  assert.equal(rows.length, 7)
  for (const row of rows) {
    assert.match(row.id, /^preset-[a-z0-9-]+$/)
    assert.equal(row.name, '@deepseek-ai/dsh-agent-preset')
    assert.equal(row.config.id, row.id.slice('preset-'.length))
    assert.ok(Array.isArray(row.config.plugins) && row.config.plugins.length > 0, `${row.config.id} declares no plugins`)
    assert.equal(typeof row.config.order, 'number')
    assert.equal(typeof row.config.name, 'string')
    assert.equal(typeof row.config.description, 'string')
  }
  // The declaration plugin's own schema accepts every config.
  for (const row of rows) {
    const config = AgentPreset.Config(row.config)
    assert.equal(config.id, row.config.id)
    assert.equal(config.plugins.length, row.config.plugins.length)
  }
  assert.deepEqual(rows.map(row => row.config.id), [
    'anchored-standard',
    'zero-anchored-standard',
    'whoami-standard',
    'prefab-anchored-standard',
    'eternal-minimal',
    'wire-think-standard',
    'combo-anchored-standard',
  ])
})

/** Flatten every row of every preset, including nested group rows. */
function* allRows(rows) {
  for (const row of rows) {
    yield row
    if (row.group === true && Array.isArray(row.config)) yield* allRows(row.config)
  }
}

test('helper rows address files this package exports', () => {
  const helpers = new Set(readdirSync(helpersDir))
  const seen = new Set()
  for (const row of composed()) {
    for (const child of allRows(row.config.plugins)) {
      if (typeof child.name !== 'string') continue
      assert.ok(!child.name.startsWith('.'), `relative row survived: ${child.name}`)
      assert.ok(!child.name.startsWith('/'), `absolute row survived: ${child.name}`)
      const match = /^@muwinds\/dsh-anchored-presets\/helpers\/([^/]+)$/.exec(child.name)
      if (match === null) continue
      assert.ok(helpers.has(match[1]), `missing helper file: ${match[1]}`)
      assert.ok(existsSync(join(helpersDir, match[1])), `unreadable helper file: ${match[1]}`)
      seen.add(match[1])
    }
  }
  assert.ok(seen.size >= 15, `only ${String(seen.size)} helper rows found`)
  // Every shipped module is reached: as a row, or as a local import of one.
  const reached = new Set(seen)
  const pending = [...seen]
  while (pending.length > 0) {
    const name = pending.pop()
    const source = readFileSync(join(helpersDir, name), 'utf8')
    for (const match of source.matchAll(/from '\.\/([A-Za-z0-9._-]+\.mjs)'/g)) {
      if (reached.has(match[1])) continue
      reached.add(match[1])
      pending.push(match[1])
    }
  }
  const shipped = [...helpers].filter(name => name.endsWith('.mjs'))
  assert.deepEqual(shipped.filter(name => !reached.has(name)), [], 'unreferenced helper modules')
})

test('applies the 0.2.1 conversions', () => {
  for (const row of composed()) {
    for (const child of allRows(row.config.plugins)) {
      assert.ok(!RETIRED_ROWS.includes(child.name), `${row.config.id} still mounts ${String(child.name)}`)
      const config = child.config
      if (child.name === '@deepseek-ai/dsh-persona') {
        assert.equal(typeof config.prefix, 'string', `${row.config.id} persona has no prefix`)
        assert.equal(config.text, undefined, `${row.config.id} persona still carries text`)
      }
      if (child.name === '@deepseek-ai/dsh-tool-subagent') {
        for (const field of RETIRED_SUBAGENT_FIELDS) {
          assert.equal(config[field], undefined, `${row.config.id} subagent still carries ${field}`)
        }
        assert.equal(typeof config.provider, 'string')
      }
    }
  }
})

test('every bare plugin name exists in this source checkout', (t) => {
  const workspace = resolve(packageDir, '../../../packages')
  if (!existsSync(workspace)) {
    t.skip('no source checkout beside this bundle')
    return
  }
  const names = new Set()
  const collect = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = join(directory, entry.name)
      if (existsSync(join(path, 'package.json'))) {
        const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
        names.add(manifest.name)
      } else {
        collect(path)
      }
    }
  }
  collect(workspace)
  const missing = new Set()
  for (const row of composed()) {
    for (const child of allRows(row.config.plugins)) {
      if (typeof child.name !== 'string') continue
      if (child.name.startsWith('cordis:') || child.name.startsWith('@muwinds/')) continue
      const bare = child.name.startsWith('@') ? child.name.split('/').slice(0, 2).join('/') : child.name.split('/')[0]
      if (!names.has(bare)) missing.add(`${child.name} (in ${row.config.id})`)
    }
  }
  assert.deepEqual([...missing], [])
})
