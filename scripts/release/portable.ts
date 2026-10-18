/**
 * Assemble a portable distribution: the harness's packed tarballs installed
 * into one directory, a Node runtime beside them, the community modules
 * installed into that directory's own home, the launch block, and a launcher.
 *
 * The consumer installs nothing and builds nothing. The bytes come from
 * `pack.ts` output, so a distribution carries exactly what the npm release
 * publishes, plus a runtime and a launcher the consumer would otherwise provide.
 *
 * This distribution ships the Web GUI and nothing else. No Electron or desktop
 * application output is read from, built into, or required by this assembly:
 * the Web frontend travels inside the `@deepseek-ai/dsh-web-frontend` tarball
 * (`apps/web/package.json` lists `dist` under `files`), so there is no separate
 * frontend walk to perform and no desktop build product to carry.
 *
 * Layout of the assembled tree:
 *
 * ```text
 * meshfin/
 * ├── app/            npm prefix: node_modules holding the packed harness
 * ├── node/           the bundled runtime (`node/bin/node`, `node/node.exe`)
 * ├── data/           the distribution's own DSH home, community modules installed
 * ├── community/      the installer and its assets, kept for later updates
 * ├── launch/         the launch block: Windows shortcut/tile, WSL and Linux launchers
 * └── meshfin(.ps1)   the launcher
 * ```
 */

import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { capture, isEntry } from './process.ts'
import { packedManifest } from './tarball.ts'

/**
 * Which archive is being assembled. `posix` is the Linux x64 archive: it ships
 * the `meshfin` shell launcher and the `linux-x64` native payload packages.
 * `windows` ships `meshfin.ps1` and fetches win32 native binaries through npm.
 */
type Platform = 'posix' | 'windows'

/** The CLI package whose bin path both launchers run. */
const CLI_PACKAGE = '@deepseek-ai/dsh'

/** Where the CLI package keeps its entry inside an installed prefix. */
const CLI_ENTRY = ['node_modules', ...CLI_PACKAGE.split('/'), 'lib', 'bin.js']

/** Repository directory holding the launch block shipped as `launch/`. */
const LAUNCH_BLOCK = ['apps', 'desktop-launcher']

/**
 * Repository directory holding the native addon's per-platform packages.
 *
 * `@deepseek-ai/node-addon-system` is published on its own release line, so
 * neither release family this step packs carries it: its entry arrives as a
 * tarball and its per-platform payloads are workspace directories holding
 * prebuilt binaries, which npm cannot fetch as a unit.
 */
const NATIVE_PACKAGES = ['native', 'system', 'packages']

/** One packed harness package the assembly extracts into `app/`. */
interface PackedMember {
  /** The package name, which is the directory it occupies under `app/node_modules`. */
  readonly name: string
  /** Absolute path of the packed tarball. */
  readonly tarball: string
}

/** What the harness installation resolves before it writes anything. */
interface HarnessPlan {
  /** Every packed harness package, so extracted directories match the manifest. */
  readonly members: readonly PackedMember[]
  /** External dependencies npm resolves from the registry, in sorted name order. */
  readonly external: ReadonlyMap<string, string>
}

/** One native payload package selected for the target platform. */
interface NativePayload {
  /** The package name, which is the directory it occupies under `app/node_modules`. */
  readonly name: string
  /** Absolute path of the repository directory holding it. */
  readonly source: string
}

/**
 * Read one directory of packed tarballs into members and external dependencies.
 *
 * Harness packages are extracted from their own tarballs rather than resolved
 * by npm: they are already built, they depend on each other by workspace
 * version, and a manifest naming hundreds of local tarballs makes npm's
 * resolver fail outright. What npm still does is fetch the external
 * dependencies, which is the part a distribution cannot carry in the repository.
 * @param tarballs - every packed tarball directory.
 * @returns the plan the harness installation executes.
 */
function planHarness(tarballs: readonly string[]): HarnessPlan {
  const members: PackedMember[] = []
  const external = new Map<string, string>()
  for (const directory of tarballs) {
    for (const filename of readdirSync(directory).filter(name => name.endsWith('.tgz')).sort()) {
      const tarball = join(directory, filename)
      const manifest = packedManifest(tarball)
      const name = typeof manifest.name === 'string' ? manifest.name : undefined
      if (name === undefined) throw new Error(`${tarball} carries no package name`)
      members.push({ name, tarball })
      const dependencies = manifest.dependencies
      if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue
      for (const [dependency, range] of Object.entries(dependencies)) {
        if (dependency.startsWith('@deepseek-ai/')) continue
        if (typeof range !== 'string') throw new Error(`${tarball} declares a non-string range for ${dependency}`)
        external.set(dependency, range)
      }
    }
  }
  if (members.length === 0) throw new Error('no packed tarball found; pass each --tarballs directory holding *.tgz')
  return { members, external }
}

/**
 * Install the packed harness into the distribution's `app` prefix.
 *
 * `--legacy-peer-deps` keeps npm from pulling a second copy of the vendored
 * framework from the registry over the one extracted here.
 * @param root - the distribution root.
 * @param plan - the members to extract and the external dependencies to resolve.
 * @param scripts - whether dependency install scripts run (they need a toolchain).
 * @param platform - the platform being packaged, which selects the native binaries npm fetches.
 */
function installHarness(root: string, plan: HarnessPlan, scripts: boolean, platform: Platform): void {
  const app = join(root, 'app')
  const modules = join(app, 'node_modules')
  mkdirSync(modules, { recursive: true })
  writeFileSync(join(app, 'package.json'), `${JSON.stringify({
    name: 'meshfin',
    version: '0.0.0',
    private: true,
    dependencies: Object.fromEntries([...plan.external].sort()),
  }, null, 2)}\n`)
  capture('npm', [
    // Optional dependencies stay IN: they are where a native package ships its
    // per-platform binary (`sharp` is the one this distribution needs), and npm
    // installs only the optional entries matching the build platform. A
    // platform whose optional native package fails is simply missing that
    // capability, which is what optional means.
    'install', '--no-audit', '--no-fund', '--package-lock=false', '--legacy-peer-deps',
    // A distribution is assembled on whatever machine the maintainer has, while
    // a native dependent ships a per-platform binary: the install must ask for
    // the platform being PACKAGED, not the platform doing the packaging.
    ...platform === 'windows' ? ['--os=win32', '--cpu=x64'] : [],
    // A distribution ships JavaScript. Two packages in the closure (`koffi`,
    // `node-pty`) are native and want a prebuilt binary or a toolchain; a
    // consumer is not expected to have either, so their install scripts are
    // skipped and the capabilities they back (the persistent terminal) are
    // simply absent from this tree.
    ...scripts ? [] : ['--ignore-scripts'],
  ], {
    cwd: app,
    // The cache stays inside the tree: a distribution build must not depend on
    // the builder's home directory being writable.
    env: { ...process.env, npm_config_cache: join(root, '.npm-cache') },
  })
  // The harness packages are extracted AFTER npm has run: npm prunes every
  // directory its own manifest does not name, so extracting first would leave a
  // prefix holding only external dependencies.
  for (const { tarball, name } of plan.members) {
    const target = join(modules, ...name.split('/'))
    mkdirSync(target, { recursive: true })
    capture('tar', ['-xzf', tarball, '-C', target, '--strip-components=1'], { cwd: root })
  }
  rmSync(join(root, '.npm-cache'), { recursive: true, force: true })
}

/**
 * Carry the launch block into the distribution.
 *
 * The launch block is not part of the harness's packages. It turns "there is a
 * server somewhere" into a double-click: a Windows shortcut and desktop tile, a
 * WSL-side owner of the server's lifetime, and a Linux desktop entry. The Web
 * GUI authenticates each browser process through a token in the URL it prints,
 * and a bare origin answers 401, so the Windows launcher lets the harness open
 * the browser itself while the WSL script runs it with `--no-open` and hands the
 * printed authenticated URL to the desktop browser. Neither polls a port.
 * @param root - the distribution root.
 * @param repository - the repository root holding `apps/desktop-launcher/`.
 * @param platform - which platform's scripts need an executable bit.
 */
function installLaunchBlock(root: string, repository: string, platform: Platform): void {
  const source = join(repository, ...LAUNCH_BLOCK)
  if (!existsSync(source)) throw new Error(`the launch block is missing at ${source}`)
  const target = join(root, 'launch')
  cpSync(source, target, { recursive: true })
  if (platform !== 'posix') return
  for (const script of ['wsl/meshfin-web.sh', 'linux/install-desktop-entry.sh']) {
    chmodSync(join(target, script), 0o755)
  }
}

/**
 * Return whether a native payload package targets the platform being packaged.
 * @param os - the payload package's declared operating systems, when it declares any.
 * @param cpu - the payload package's declared architectures, when it declares any.
 * @param platform - the platform being packaged.
 * @returns true when npm would install this package on that platform.
 */
function payloadTargets(
  os: readonly string[] | undefined,
  cpu: readonly string[] | undefined,
  platform: Platform,
): boolean {
  const target = platform === 'windows' ? 'win32' : 'linux'
  return os?.includes(target) === true && cpu?.includes('x64') === true
}

/**
 * Select the native addon's payload packages for the platform being packaged.
 *
 * The addon's JavaScript entry ships as a packed tarball and reaches `app/`
 * through {@link installHarness}. Only its per-platform payloads are repository
 * directories, and the entry resolves them by name at call time: a platform
 * with no payload package simply has no confining launcher, which is why this
 * selection filters instead of failing. Windows has no payload package — that
 * platform confines through `@deepseek-ai/dsh-sandbox-windows-acl` — while its
 * JavaScript entry is still extracted, so the static imports in
 * `@deepseek-ai/dsh-sandbox-local` and the JSONL session lease still resolve.
 * @param repository - the repository root holding `native/`.
 * @param platform - the platform being packaged.
 * @returns the payload packages to copy, in name order.
 */
function planNativePayloads(repository: string, platform: Platform): NativePayload[] {
  const packages = join(repository, ...NATIVE_PACKAGES)
  if (!existsSync(packages)) return []
  const selected: NativePayload[] = []
  for (const directory of readdirSync(packages).sort()) {
    // `entry` is the JavaScript package itself, carried as a tarball.
    if (directory === 'entry') continue
    const source = join(packages, directory)
    if (!existsSync(join(source, 'package.json'))) continue
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) as Record<string, unknown>
    const os = Array.isArray(manifest.os) ? manifest.os.filter(value => typeof value === 'string') : undefined
    const cpu = Array.isArray(manifest.cpu) ? manifest.cpu.filter(value => typeof value === 'string') : undefined
    if (typeof manifest.name !== 'string' || !payloadTargets(os, cpu, platform)) continue
    selected.push({ name: manifest.name, source })
  }
  return selected
}

/**
 * Copy the selected native payload packages beside the extracted harness.
 * @param root - the distribution root.
 * @param payloads - the payload packages selected for the target platform.
 */
function installNativePayloads(root: string, payloads: readonly NativePayload[]): void {
  for (const { name, source } of payloads) {
    const target = join(root, 'app', 'node_modules', ...name.split('/'))
    mkdirSync(target, { recursive: true })
    cpSync(source, target, { recursive: true })
  }
}

/**
 * Copy a Node runtime binary into the distribution.
 * @param root - the distribution root.
 * @param binary - the Node binary to carry.
 * @param platform - which file name the launcher expects.
 */
function installRuntime(root: string, binary: string, platform: Platform): void {
  const target = platform === 'posix' ? join(root, 'node', 'bin', 'node') : join(root, 'node', 'node.exe')
  mkdirSync(join(root, 'node', ...platform === 'posix' ? ['bin'] : []), { recursive: true })
  cpSync(binary, target)
  if (platform === 'posix') chmodSync(target, 0o755)
}

/**
 * Install the community modules into the distribution's own home.
 *
 * The installer is a repository-layout tool — it resolves the CLI through
 * `apps/cli/src/bin.ts` — so it cannot run from inside an assembled tree. It
 * runs from the checkout and writes the distribution's home, while the
 * distribution keeps its own copy so a later update can run against that home.
 * @param root - the distribution root.
 * @param repository - the repository root holding `community/`.
 */
function installCommunity(root: string, repository: string): void {
  cpSync(join(repository, 'community'), join(root, 'community'), { recursive: true })
  capture(process.execPath, [
    join(repository, 'community', 'install.mjs'),
    '--dsh-home', join(root, 'data'),
  ], { cwd: repository })
}

/** The launcher file one platform ships. */
interface LauncherFile {
  /** File name at the distribution root. */
  readonly name: string
  /** The file's entire contents. */
  readonly contents: string
}

/**
 * Render the launcher that runs the bundled CLI under the distribution's home.
 *
 * The launcher only forwards arguments: which profile to boot and which flags
 * that profile's app understands stay the caller's decision, so the launch
 * block runs `meshfin web` and this file never chooses a profile itself.
 * @param platform - which launcher to render.
 * @returns file name and contents for the platform's launcher.
 */
export function launcherFile(platform: Platform): LauncherFile {
  if (platform === 'posix') {
    return {
      name: 'meshfin',
      contents: [
        '#!/bin/sh',
        '# Meshfin: run this distribution\'s harness. DSH_HOME defaults to the',
        '# distribution\'s own data directory, so nothing is written outside it.',
        'set -e',
        'here=$(cd -- "$(dirname -- "$0")" && pwd)',
        ': "${DSH_HOME:=$here/data}"',
        'export DSH_HOME',
        `exec "$here/node/bin/node" "$here/app/${CLI_ENTRY.join('/')}" "$@"`,
        '',
      ].join('\n'),
    }
  }
  return {
    name: 'meshfin.ps1',
    contents: [
      '# Meshfin: run this distribution\'s harness. DSH_HOME defaults to the',
      '# distribution\'s own data directory, so nothing is written outside it.',
      "$ErrorActionPreference = 'Stop'",
      '$here = Split-Path -Parent $MyInvocation.MyCommand.Path',
      "if (-not $env:DSH_HOME) { $env:DSH_HOME = Join-Path $here 'data' }",
      `& (Join-Path $here 'node\\node.exe') (Join-Path $here 'app\\${CLI_ENTRY.join('\\')}') @args`,
      'exit $LASTEXITCODE',
      '',
    ].join('\r\n'),
  }
}

/**
 * Write the launcher that runs the bundled CLI under the distribution's home.
 * @param root - the distribution root.
 * @param platform - which launcher to write.
 */
function writeLauncher(root: string, platform: Platform): void {
  const { name, contents } = launcherFile(platform)
  const launcher = join(root, name)
  writeFileSync(launcher, contents)
  if (platform === 'posix') chmodSync(launcher, 0o755)
}

/** What one assembly produces; `--dry-run` prints it without writing. */
interface AssemblyPlan {
  /** Absolute distribution root. */
  readonly out: string
  /** Platform being packaged. */
  readonly platform: Platform
  /** Packed harness members and the external dependencies npm resolves. */
  readonly harness: HarnessPlan
  /** Native payload packages copied beside the harness. */
  readonly payloads: readonly NativePayload[]
  /** Absolute path of the Node binary carried into `node/`. */
  readonly runtime: string
  /** Launcher file written at the root. */
  readonly launcher: LauncherFile
}

/**
 * Resolve everything one assembly needs, without writing to the output tree.
 * @param root - the repository root.
 * @param options - the distribution's tarball directories, output directory, Node binary, and platform.
 * @returns the resolved assembly plan.
 */
export function planAssembly(
  root: string,
  options: { tarballs: readonly string[]; out: string; runtime: string; platform: Platform },
): AssemblyPlan {
  const runtime = resolve(root, options.runtime)
  if (!existsSync(runtime)) throw new Error(`the Node runtime is missing at ${runtime}`)
  if (!existsSync(join(root, ...LAUNCH_BLOCK))) throw new Error(`the launch block is missing at ${join(root, ...LAUNCH_BLOCK)}`)
  return {
    out: resolve(root, options.out),
    platform: options.platform,
    harness: planHarness(options.tarballs.map(directory => resolve(root, directory))),
    payloads: planNativePayloads(root, options.platform),
    runtime,
    launcher: launcherFile(options.platform),
  }
}

/**
 * Print one assembly plan: what each step reads and where it writes.
 * @param plan - the resolved plan.
 */
export function describePlan(plan: AssemblyPlan): string[] {
  const lines = [
    `release portable: dry run for ${plan.out} (${plan.platform})`,
    `  app/          ${String(plan.harness.members.length)} packed package(s) extracted,`
      + ` ${String(plan.harness.external.size)} external dependency name(s) resolved by npm`,
    `  launch/       the launch block from ${LAUNCH_BLOCK.join('/')}`,
    `  app/node_modules/  ${plan.payloads.length === 0
      ? 'no native payload package for this platform'
      : `${String(plan.payloads.length)} native payload package(s): ${plan.payloads.map(payload => payload.name).join(', ')}`}`,
    `  node/         runtime copied from ${plan.runtime}`,
    '  community/    the installer and its assets, plus one install into data/',
    `  ${plan.launcher.name.padEnd(13)} launcher written at the root`,
  ]
  for (const member of plan.harness.members) lines.push(`  packed: ${member.name} <- ${member.tarball}`)
  return lines
}

/**
 * Assemble one distribution from a resolved plan.
 * @param root - the repository root.
 * @param plan - the resolved plan.
 * @param scripts - whether dependency install scripts run.
 */
function assemble(root: string, plan: AssemblyPlan, scripts: boolean): void {
  rmSync(plan.out, { recursive: true, force: true })
  mkdirSync(plan.out, { recursive: true })
  installHarness(plan.out, plan.harness, scripts, plan.platform)
  installLaunchBlock(plan.out, root, plan.platform)
  installNativePayloads(plan.out, plan.payloads)
  installRuntime(plan.out, plan.runtime, plan.platform)
  installCommunity(plan.out, root)
  writeLauncher(plan.out, plan.platform)
  console.log(`release portable: assembled ${plan.out}`)
}

/** Assemble the distribution named by `--tarballs`/`--out`/`--runtime`/`--platform`. */
function main(): void {
  const { values } = parseArgs({
    options: {
      tarballs: { type: 'string', multiple: true },
      out: { type: 'string' },
      runtime: { type: 'string' },
      platform: { type: 'string' },
      'with-scripts': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
    },
    allowPositionals: false,
  })
  if (values.tarballs === undefined || values.out === undefined || values.runtime === undefined) {
    throw new Error(
      'usage: portable.ts --tarballs <directory> [--tarballs <directory>] --out <directory>'
      + ' --runtime <node binary> [--platform posix|windows] [--with-scripts] [--dry-run]',
    )
  }
  const platform = values.platform ?? 'posix'
  if (platform !== 'posix' && platform !== 'windows') throw new Error(`unknown platform ${platform}`)
  const root = process.cwd()
  const plan = planAssembly(root, {
    tarballs: values.tarballs,
    out: values.out,
    runtime: values.runtime,
    platform,
  })
  if (values['dry-run'] === true) {
    for (const line of describePlan(plan)) console.log(line)
    return
  }
  assemble(root, plan, values['with-scripts'] === true)
}

if (isEntry(import.meta.url)) main()
