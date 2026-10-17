/**
 * Install the community surface into one DeepSeek Harness profile.
 *
 * Upstream 0.2.1-rc.2 reads nothing from `$DSH_HOME/.agent-presets`: an agent
 * preset is a declaration row inside a bundle patch, so both halves of this
 * distribution ship as bundles and install through the package-manager path the
 * CLI owns:
 *
 *   dsh plugin --profile <profile> add <bundle directory>
 *
 * `--update` removes a bundle before adding it again. With HMR running, the
 * plugin manager refuses an install over a package the profile already depends
 * on (`already-installed`), so the remove step is what makes a reinstall
 * possible.
 *
 * This script runs no package manager itself and writes no preset directory:
 * `dsh plugin` owns installation, compatibility preflight, and bundle selection.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const communityDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = resolve(communityDirectory, '..')

/** Bundles this distribution installs, in install order. */
export const BUNDLES = Object.freeze([
  Object.freeze({ directory: 'archived-sessions', packageName: '@muwinds/dsh-archived-sessions' }),
  Object.freeze({ directory: 'anchored-presets', packageName: '@muwinds/dsh-anchored-presets' }),
])

/** Source-mode `dsh` entry point, used when `--dsh-command` is omitted. */
const SOURCE_BIN = join(repositoryDirectory, 'apps/cli/src/bin.ts')

/**
 * Resolve `~` and `~/…` against the home directory.
 * @param path - a path that may start with `~`.
 * @returns the expanded path.
 */
export function expandHome(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return join(homedir(), ...path.slice(2).split(/[\\/]+/).filter(Boolean))
  }
  return path
}

/**
 * Parse this script's flags.
 * @param argv - arguments after the script name.
 * @param env - environment the defaults read (`DSH_HOME`).
 * @returns the resolved options.
 * @throws for an unknown, duplicated, or value-less flag, or an unusable profile name.
 */
export function parseArguments(argv, env = process.env) {
  const options = { dshHome: undefined, dshCommand: undefined, profile: 'web', update: false }
  const valueFlags = new Set(['--dsh-home', '--dsh-command', '--profile'])
  const used = new Set()
  const args = argv[0] === '--' ? argv.slice(1) : argv
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument !== '--update' && !valueFlags.has(argument)) throw new Error(`Unknown flag: ${argument}`)
    if (used.has(argument)) throw new Error(`Duplicate flag: ${argument}`)
    used.add(argument)
    if (argument === '--update') {
      options.update = true
      continue
    }
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--') || value.trim() === '') {
      throw new Error(`Missing value for ${argument}`)
    }
    index += 1
    if (argument === '--dsh-home') options.dshHome = value
    else if (argument === '--dsh-command') options.dshCommand = value
    else options.profile = value
  }
  if (options.profile.trim() === '' || /[\\/]/.test(options.profile)) {
    throw new Error(`Invalid profile name: ${JSON.stringify(options.profile)}`)
  }
  const environmentHome = env.DSH_HOME?.trim() || undefined
  return {
    profile: options.profile,
    update: options.update,
    dshHome: resolve(expandHome(options.dshHome ?? environmentHome ?? join(homedir(), '.dsh'))),
    dshCommand: options.dshCommand,
  }
}

/**
 * Profile directory that `dsh plugin --profile <name>` manages.
 * @param dshHome - the Harness home.
 * @param profile - the profile name.
 * @returns the absolute profile directory.
 */
export function profileDirectory(dshHome, profile) {
  return join(dshHome, 'profiles', profile)
}

/**
 * Whether the profile manifest already depends on a package.
 * @param dshHome - the Harness home.
 * @param profile - the profile name.
 * @param packageName - the dependency key.
 * @returns true when the profile's `package.json` names it.
 */
export function isInstalled(dshHome, profile, packageName) {
  const manifest = join(profileDirectory(dshHome, profile), 'package.json')
  if (!existsSync(manifest)) return false
  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
    return Object.hasOwn(parsed.dependencies ?? {}, packageName)
  } catch {
    // An unreadable manifest is `dsh plugin`'s diagnostic to report, not a reason to skip the install.
    return false
  }
}

/**
 * Build the process arguments for one `dsh` invocation.
 * @param options - resolved options.
 * @param rest - `dsh` arguments after the executable.
 * @returns the process arguments passed to `node`.
 */
export function dshArguments(options, rest) {
  if (options.dshCommand !== undefined) return [options.dshCommand, ...rest]
  return ['--import', 'tsx/esm', SOURCE_BIN, ...rest]
}

/**
 * Plan the install as an ordered list of `dsh` invocations.
 *
 * `--update` plans `remove` only for a bundle the profile already depends on:
 * removing an absent package is a package-manager error, not an update step.
 * @param options - resolved options.
 * @param installed - predicate answering whether the profile depends on a package name.
 * @returns the invocations, each naming the bundle it serves.
 */
export function planCommands(options, installed = isInstalled) {
  const steps = []
  for (const bundle of BUNDLES) {
    const directory = join(communityDirectory, 'bundles', bundle.directory)
    if (!existsSync(join(directory, 'package.json'))) throw new Error(`Bundle has no manifest: ${directory}`)
    if (options.update && installed(options.dshHome, options.profile, bundle.packageName)) {
      steps.push({
        bundle: bundle.directory,
        describe: `remove ${bundle.packageName}`,
        args: dshArguments(options, ['plugin', '--profile', options.profile, 'remove', bundle.packageName]),
      })
    }
    steps.push({
      bundle: bundle.directory,
      describe: `add ${directory}`,
      args: dshArguments(options, ['plugin', '--profile', options.profile, 'add', directory]),
    })
  }
  return steps
}

/**
 * Run one planned invocation with the Harness home pinned.
 * @param step - the planned invocation.
 * @param options - resolved options.
 * @returns the child's exit status.
 */
export function runStep(step, options) {
  const result = spawnSync(process.execPath, step.args, {
    cwd: repositoryDirectory,
    env: { ...process.env, DSH_HOME: options.dshHome },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  return result.status ?? 1
}

/**
 * Install every bundle, stopping at the first failure.
 * @param options - resolved options.
 * @param run - invocation runner; injectable for tests.
 * @param report - progress sink; injectable for tests.
 * @returns zero when every step succeeded, otherwise the failing step's status.
 */
export function install(options, run = runStep, report = (text) => process.stdout.write(text)) {
  const steps = planCommands(options)
  report(`dsh-community-suite: profile ${options.profile} at ${profileDirectory(options.dshHome, options.profile)}\n`)
  for (const step of steps) {
    report(`dsh-community-suite: ${step.describe}\n`)
    const status = run(step, options)
    if (status !== 0) {
      report(`dsh-community-suite: ${step.describe} failed with exit code ${status}\n`)
      return status
    }
  }
  report('dsh-community-suite: installed; restart Harness to load the bundles\n')
  return 0
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2))
    process.exitCode = install(options)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
