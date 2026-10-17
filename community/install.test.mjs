/**
 * Installer contract on 0.2.1-rc.2: the installer plans `dsh plugin` invocations
 * and owns no preset directory, no backups, and no package manager call.
 *
 * Everything below drives the exported planning and execution seam, so no pnpm
 * or `dsh` process runs.
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  BUNDLES,
  dshArguments,
  install,
  isInstalled,
  parseArguments,
  planCommands,
  profileDirectory,
} from './install.mjs'

const communityDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = resolve(communityDirectory, '..')

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-community-suite-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const dshHome = join(directory, 'dsh-home')
  await mkdir(dshHome)
  return { directory, dshHome }
}

async function writeProfile(dshHome, profile, dependencies) {
  const directory = profileDirectory(dshHome, profile)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), `${JSON.stringify({ name: 'profile', dependencies }, undefined, 2)}\n`)
}

test('defaults to the web profile under the Harness home', () => {
  const options = parseArguments([], {})
  assert.equal(options.profile, 'web')
  assert.equal(options.update, false)
  assert.equal(options.dshCommand, undefined)
  assert.equal(options.dshHome, resolve(join(homedir(), '.dsh')))
})

test('accepts --dsh-home, --profile, --dsh-command, and a leading --', () => {
  const options = parseArguments(
    ['--', '--dsh-home', './home', '--profile', 'headless', '--dsh-command', '/opt/dsh', '--update'],
    {},
  )
  assert.equal(options.dshHome, resolve('./home'))
  assert.equal(options.profile, 'headless')
  assert.equal(options.dshCommand, '/opt/dsh')
  assert.equal(options.update, true)
})

test('expands a leading ~ in --dsh-home and reads DSH_HOME', () => {
  assert.equal(parseArguments(['--dsh-home', '~/h'], {}).dshHome, join(homedir(), 'h'))
  assert.equal(parseArguments([], { DSH_HOME: '/tmp/dsh-home' }).dshHome, resolve('/tmp/dsh-home'))
})

test('rejects unknown, duplicated, and value-less flags', () => {
  assert.throws(() => parseArguments(['--nope'], {}), /Unknown flag/)
  assert.throws(() => parseArguments(['--update', '--update'], {}), /Duplicate flag/)
  assert.throws(() => parseArguments(['--profile'], {}), /Missing value/)
  assert.throws(() => parseArguments(['--profile', '--update'], {}), /Missing value/)
  assert.throws(() => parseArguments(['--profile', 'a/b'], {}), /Invalid profile name/)
})

test('launches the source dsh entry through tsx unless a command is given', () => {
  const source = dshArguments(parseArguments([], {}), ['plugin', '--profile', 'web', 'add', '/bundle'])
  assert.deepEqual(source.slice(0, 3), ['--import', 'tsx/esm', join(repositoryDirectory, 'apps/cli/src/bin.ts')])
  assert.deepEqual(source.slice(3), ['plugin', '--profile', 'web', 'add', '/bundle'])
  const explicit = dshArguments(parseArguments(['--dsh-command', '/opt/dsh'], {}), ['plugin'])
  assert.deepEqual(explicit, ['/opt/dsh', 'plugin'])
})

test('installs both bundles in order without any preset directory step', async (t) => {
  const { dshHome } = await fixture(t)
  const steps = planCommands(parseArguments(['--dsh-home', dshHome], {}))
  assert.deepEqual(steps.map((step) => step.bundle), BUNDLES.map((bundle) => bundle.directory))
  assert.deepEqual(steps.map((step) => step.describe), BUNDLES.map((bundle) => `add ${join(communityDirectory, 'bundles', bundle.directory)}`))
  for (const step of steps) {
    assert.deepEqual(step.args.slice(3), ['plugin', '--profile', 'web', 'add', join(communityDirectory, 'bundles', step.bundle)])
  }
  assert.ok(!steps.some((step) => /agent-presets|remove/.test(step.describe)))
})

test('--update removes an installed bundle before adding it again', async (t) => {
  const { dshHome } = await fixture(t)
  await writeProfile(dshHome, 'web', { '@muwinds/dsh-archived-sessions': `file:${join(communityDirectory, 'bundles', 'archived-sessions')}` })
  const steps = planCommands(parseArguments(['--dsh-home', dshHome, '--update'], {}))
  assert.deepEqual(steps.map((step) => step.describe), [
    'remove @muwinds/dsh-archived-sessions',
    `add ${join(communityDirectory, 'bundles', 'archived-sessions')}`,
    `add ${join(communityDirectory, 'bundles', 'anchored-presets')}`,
  ])
  assert.deepEqual(steps[0].args.slice(3), ['plugin', '--profile', 'web', 'remove', '@muwinds/dsh-archived-sessions'])
})

test('--update still installs a bundle the profile does not depend on', async (t) => {
  const { dshHome } = await fixture(t)
  await writeProfile(dshHome, 'web', {})
  const steps = planCommands(parseArguments(['--dsh-home', dshHome, '--update'], {}))
  assert.deepEqual(steps.map((step) => step.describe), [
    `add ${join(communityDirectory, 'bundles', 'archived-sessions')}`,
    `add ${join(communityDirectory, 'bundles', 'anchored-presets')}`,
  ])
})

test('--profile targets the named profile on every step', async (t) => {
  const { dshHome } = await fixture(t)
  await writeProfile(dshHome, 'web', { '@muwinds/dsh-anchored-presets': 'file:./bundles/anchored-presets' })
  const web = planCommands(parseArguments(['--dsh-home', dshHome, '--update'], {}))
  assert.ok(web.some((step) => step.describe.startsWith('remove')))
  const other = planCommands(parseArguments(['--dsh-home', dshHome, '--update', '--profile', 'headless'], {}))
  assert.ok(!other.some((step) => step.describe.startsWith('remove')))
  for (const step of other) assert.equal(step.args[3 + 1], '--profile')
  for (const step of other) assert.equal(step.args[5], 'headless')
})

test('reads dependencies from the profile manifest it is pointed at', async (t) => {
  const { dshHome } = await fixture(t)
  assert.equal(isInstalled(dshHome, 'web', '@muwinds/dsh-archived-sessions'), false)
  await writeProfile(dshHome, 'web', { '@muwinds/dsh-archived-sessions': 'file:./x' })
  assert.equal(isInstalled(dshHome, 'web', '@muwinds/dsh-archived-sessions'), true)
  assert.equal(isInstalled(dshHome, 'web', '@muwinds/dsh-anchored-presets'), false)
})

test('runs every planned step and reports each one', async (t) => {
  const { dshHome } = await fixture(t)
  const seen = []
  const lines = []
  const status = install(
    parseArguments(['--dsh-home', dshHome], {}),
    (step, options) => {
      seen.push({ describe: step.describe, dshHome: options.dshHome })
      return 0
    },
    (text) => lines.push(text),
  )
  assert.equal(status, 0)
  assert.deepEqual(seen.map((entry) => entry.describe), BUNDLES.map((bundle) => `add ${join(communityDirectory, 'bundles', bundle.directory)}`))
  assert.ok(seen.every((entry) => entry.dshHome === dshHome))
  assert.match(lines[0], /profile web/)
  assert.match(lines.at(-1), /restart Harness/)
})

test('stops at the first failing step and returns its status', async (t) => {
  const { dshHome } = await fixture(t)
  const seen = []
  const lines = []
  const status = install(
    parseArguments(['--dsh-home', dshHome], {}),
    (step) => {
      seen.push(step.describe)
      return seen.length === 1 ? 2 : 0
    },
    (text) => lines.push(text),
  )
  assert.equal(status, 2)
  assert.equal(seen.length, 1)
  assert.match(lines.at(-1), /failed with exit code 2/)
})
