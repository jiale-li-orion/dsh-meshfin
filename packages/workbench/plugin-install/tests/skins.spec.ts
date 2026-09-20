/**
 * Profile row arithmetic: which rows the installed appearance bundles insert,
 * how the patch layer's disabled overrides read, and the rewrite that flips one.
 * Everything runs against a temporary profile directory.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  insertedRows,
  isDisabled,
  listRows,
  profileDirectory,
  setRowEnabled,
  withRowEnabled,
} from '../src/skins.ts'

let root: string

/** Write one file, creating its parent directories. */
function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

/** Install one bundle into the temporary profile with a patch inserting one row. */
function installBundle(directory: string, pkg: string, rowId: string): void {
  write(join(directory, 'node_modules', pkg, 'package.json'), JSON.stringify({
    name: pkg,
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  write(join(directory, 'node_modules', pkg, 'cordis.patch.yml'), `- insert:\n    - id: ${rowId}\n      name: ${pkg}\n`)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-skins-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe('profileDirectory', () => {
  it('honours DSH_HOME and otherwise falls back to the home directory', () => {
    vi.stubEnv('DSH_HOME', '/custom/home')
    // profileDirectory joins segments with the platform separator, so the
    // expectation is built the same way rather than pinning POSIX separators.
    expect(profileDirectory('web')).toBe(join('/custom/home', 'profiles', 'web'))
    vi.stubEnv('DSH_HOME', undefined)
    expect(profileDirectory('web')).toMatch(/[\\/]\.dsh[\\/]profiles[\\/]web$/)
  })
})

describe('insertedRows', () => {
  it('returns the appearance rows, skipping everything else', () => {
    write(join(root, 'package.json'), JSON.stringify({
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@dsh-external/dsh-skin-x', 7, 'dsh-plain'] } },
    }))
    installBundle(root, '@dsh-external/dsh-skin-x', 'ui-skin-x')
    // A non-appearance bundle contributes nothing even when it inserts rows.
    installBundle(root, 'dsh-plain', 'plain-row')

    expect(insertedRows(root)).toEqual([{ id: 'ui-skin-x', name: '@dsh-external/dsh-skin-x' }])
    expect(insertedRows(root, false).map(row => row.id)).toEqual(['ui-skin-x', 'plain-row'])
  })

  it('skips a bundle with no manifest, no patch declaration, or no patch file', () => {
    write(join(root, 'package.json'), JSON.stringify({
      dsh: { profile: { bundles: ['dsh-skin-missing', 'dsh-skin-declared', 'dsh-skin-absent'] } },
    }))
    write(join(root, 'node_modules', 'dsh-skin-declared', 'package.json'), JSON.stringify({ name: 'dsh-skin-declared', dsh: {} }))
    write(join(root, 'node_modules', 'dsh-skin-absent', 'package.json'), JSON.stringify({
      name: 'dsh-skin-absent',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))

    expect(insertedRows(root)).toEqual([])
  })

  it('returns nothing for a profile without a bundle list or a readable manifest', () => {
    expect(insertedRows(root)).toEqual([])
    write(join(root, 'package.json'), 'not json')
    expect(insertedRows(root)).toEqual([])
    write(join(root, 'package.json'), JSON.stringify({ dsh: {} }))
    expect(insertedRows(root)).toEqual([])
  })
})

describe('isDisabled', () => {
  it('reads the disabled flag of the row block only', () => {
    const patch = '- id: ui-skin-x\n  disabled: true\n- id: ui-skin-y\n  config:\n    a: 1\n'
    expect(isDisabled(patch, 'ui-skin-x')).toBe(true)
    expect(isDisabled(patch, 'ui-skin-y')).toBe(false)
    expect(isDisabled(patch, 'ui-skin-absent')).toBe(false)
  })
})

describe('withRowEnabled', () => {
  it('appends a disabling block, separating it from the existing layer', () => {
    expect(withRowEnabled('', 'ui-skin-x', false)).toBe('- id: ui-skin-x\n  disabled: true\n')
    expect(withRowEnabled('# comment\n', 'ui-skin-x', false))
      .toBe('# comment\n\n- id: ui-skin-x\n  disabled: true\n')
    expect(withRowEnabled('# comment', 'ui-skin-x', false))
      .toBe('# comment\n\n- id: ui-skin-x\n  disabled: true\n')
    expect(withRowEnabled('# comment\n\n', 'ui-skin-x', false))
      .toBe('# comment\n\n- id: ui-skin-x\n  disabled: true\n')
    expect(withRowEnabled('- id: other\n  disabled: false\n', 'ui-skin-x', false))
      .toBe('- id: other\n  disabled: false\n\n- id: ui-skin-x\n  disabled: true\n')
  })

  it('rewrites an existing block and removes it again when enabling', () => {
    const patch = '- id: ui-skin-x\n  config:\n    keep: 1\n'
    const disabled = withRowEnabled(patch, 'ui-skin-x', false)
    expect(disabled).toBe('- id: ui-skin-x\n  disabled: true\n')
    expect(withRowEnabled(disabled, 'ui-skin-x', true)).toBe('')
    // Enabling a row the patch never mentioned leaves the layer untouched.
    expect(withRowEnabled(patch, 'ui-skin-y', true)).toBe(patch)
  })
})

describe('listRows and setRowEnabled', () => {
  it('reports each row with its enablement and flips it through the patch file', () => {
    write(join(root, 'package.json'), JSON.stringify({
      dsh: { profile: { bundles: ['@dsh-external/dsh-skin-x'] } },
    }))
    installBundle(root, '@dsh-external/dsh-skin-x', 'ui-skin-x')

    expect(listRows(root)).toEqual([{ id: 'ui-skin-x', name: '@dsh-external/dsh-skin-x', enabled: true }])
    setRowEnabled(root, 'ui-skin-x', false)
    expect(readFileSync(join(root, 'cordis.patch.yml'), 'utf8')).toBe('- id: ui-skin-x\n  disabled: true\n')
    expect(listRows(root)).toEqual([{ id: 'ui-skin-x', name: '@dsh-external/dsh-skin-x', enabled: false }])
    setRowEnabled(root, 'ui-skin-x', true)
    expect(readFileSync(join(root, 'cordis.patch.yml'), 'utf8')).toBe('')
  })

  it('refuses a row this profile does not declare', () => {
    write(join(root, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: [] } } }))
    expect(() => { setRowEnabled(root, 'ui-skin-nope', false) }).toThrow(/no appearance row "ui-skin-nope"/)
  })
})
