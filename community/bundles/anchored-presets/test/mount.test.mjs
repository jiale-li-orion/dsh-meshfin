/**
 * Mount: every preset's helper rows import and reach a Loader entry through the
 * real preset mount path (`mountPreset`), and relative rows resolve against the
 * boot configuration base rather than the bundle — the reason the helpers ship
 * as package subpaths.
 *
 * Service-consuming rows settle as `pending` here: this harness supplies no Host
 * services. A row that fails to import or activate is a `failed` entry and fails
 * the test.
 */
import assert from 'node:assert/strict'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import Group from '@deepseek-ai/cordis-plugin-group'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { createScope } from '@deepseek-ai/dsh-scope'
import { auditRows } from '@deepseek-ai/dsh-agent-preset-registry'
import { mountPreset } from '../../../../packages/preset/agent-preset-registry/src/mount.ts'

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
const helpersDir = join(packageDir, 'helpers')
const composed = composeEntries([loadOverlayPatches('dsh', join(packageDir, 'cordis.patch.yml'))])

/** Every nested row of a declared plugin list. */
function* allRows(rows) {
  for (const row of rows) {
    yield row
    if (row.group === true && Array.isArray(row.config)) yield* allRows(row.config)
  }
}

/**
 * Mount one plugin list through the real registry entry point.
 * @param id - preset id for diagnostics.
 * @param rows - plugin rows.
 * @param base - the boot configuration base URL the mount inherits.
 * @returns the row audit and the mounted entry names.
 */
async function mountRows(id, rows, base) {
  const ctx = new Context()
  ctx.baseUrl = base
  await ctx.plugin(Loader)
  ctx.loader.builtins.group = Group
  let outcome
  await ctx.plugin({
    name: 'mount-probe',
    inject: ['loader'],
    async apply(owner) {
      const scope = createScope(owner, {})
      try {
        const mount = await mountPreset(scope.ctx.extend({ baseUrl: ctx.baseUrl }), id, rows)
        outcome = { audit: await auditRows(mount.tree), names: [...mount.tree.entries()].map(entry => entry.options.name) }
      } catch (error) {
        outcome = { error }
      } finally {
        await scope.dispose()
      }
    },
  })
  await ctx.fiber.dispose()
  return outcome
}

test('every preset mounts with package-shipped helpers', async () => {
  for (const preset of composed) {
    const helperRows = [...allRows(preset.config.plugins)]
      .filter(row => typeof row.name === 'string' && row.name.startsWith('@muwinds/dsh-anchored-presets/helpers/'))
      .map(row => ({ ...row, name: pathToFileURL(join(helpersDir, basename(row.name))).href }))
    assert.ok(helperRows.length > 0, `${preset.config.id} declares no helper rows`)
    const outcome = await mountRows(preset.config.id, helperRows, pathToFileURL(packageDir).href + '/')
    assert.equal(outcome.error, undefined, `${preset.config.id}: ${String(outcome.error && outcome.error.message)}`)
    assert.deepEqual(outcome.audit.failed, [], `${preset.config.id} failed rows`)
    assert.equal(outcome.names.length, helperRows.length, `${preset.config.id} mounted ${String(outcome.names.length)} of ${String(helperRows.length)} helper rows`)
  }
})

test('a relative row resolves against the boot base, not the bundle', async () => {
  const row = { id: 'context-gate', name: './context-gate.mjs' }
  // The file exists, one directory below the bundle root: a bundle-relative row
  // still cannot reach it, because the mount resolves against the boot base.
  const besideBundle = await mountRows('relative-base', [row], pathToFileURL(packageDir).href + '/')
  assert.ok(besideBundle.error, 'a bundle-relative row must not mount')
  assert.match(String(besideBundle.error.message), /context-gate\.mjs/)

  const besideHelpers = await mountRows('relative-helpers', [row], pathToFileURL(helpersDir).href + '/')
  assert.deepEqual(besideHelpers.audit.failed, [], 'the same row resolves beside the boot base')
})
