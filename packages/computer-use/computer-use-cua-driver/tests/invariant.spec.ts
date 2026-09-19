/**
 * The companion registers under the package name and releases with its fiber.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as companion from '../src/invariant.ts'

describe('computer-use-cua-driver invariant companion', () => {
  it('declares its identity and explained empty installer', async () => {
    expect(companion.name).toBe('computer-use-cua-driver-invariant')
    expect(companion.inject).toEqual(['invariants'])
    const ctx = new Context()
    const registered: string[] = []
    ctx.provide('invariants', {
      register: (pkg: string) => { registered.push(pkg); return () => {} },
    } as never)
    const dispose = await companion.apply(ctx)
    expect(registered).toEqual(['@deepseek-ai/dsh-computer-use-cua-driver'])
    dispose()
  })
})
