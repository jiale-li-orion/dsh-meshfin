/**
 * The three workbench view tools over the real tools registry and a fake
 * workbench service: each call writes the shared view once and returns the
 * model-facing notice for the committed state.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { WorkbenchView } from '@deepseek-ai/dsh-workbench/types'
import * as ToolWorkbench from '../src/index.ts'

/** Fake shared service recording every transition the tools make. */
function fakeWorkbench() {
  let view: WorkbenchView = { open: false, active: null }
  const service = {
    state: vi.fn((): WorkbenchView => ({ ...view })),
    open: vi.fn((panelId: string | null): WorkbenchView => {
      view = { open: true, active: panelId ?? view.active }
      return { ...view }
    }),
    close: vi.fn((): WorkbenchView => {
      view = { open: false, active: view.active }
      return { ...view }
    }),
  }
  return { service, current: () => view }
}

/** Boot the tools over the real registry and the fake workbench service. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fake = fakeWorkbench()
  ctx.provide('workbench', fake.service as never)
  await ctx.plugin(ToolWorkbench)
  return { ctx, ...fake }
}

const signal = new AbortController().signal
let call = 0

/** Execute one registered tool and return its execution-local canonical value. */
async function run(ctx: Context, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await ctx.tools.execute({ signal, callId: ToolCallId(`call-${++call}`), name, arguments: args })
  if (result.isError) throw new Error(`tool ${name} failed: ${JSON.stringify(result.error)}`)
  return result.value
}

describe('tool-workbench', () => {
  it('registers the three view tools', async () => {
    const { ctx } = await harness()
    expect(ToolWorkbench.inject).toEqual(['tools', 'workbench'])
    for (const name of ['workbench_open', 'workbench_close', 'workbench_status']) {
      expect(ctx.tools.get(name)).toBeDefined()
    }
  })

  it('workbench_open writes the shared view and reports the committed state', async () => {
    const { ctx, service } = await harness()
    expect(await run(ctx, 'workbench_open', { panel: 'files' }))
      .toEqual({ text: 'Workbench opened on panel "files".', open: true, active: 'files' })
    expect(service.open).toHaveBeenCalledWith('files')
    expect(await run(ctx, 'workbench_open', {}))
      .toEqual({ text: 'Workbench opened on panel "files".', open: true, active: 'files' })
    expect(service.open).toHaveBeenLastCalledWith(null)
  })

  it('workbench_close closes the shared view and keeps the selection', async () => {
    const { ctx } = await harness()
    await run(ctx, 'workbench_open', { panel: 'git' })
    expect(await run(ctx, 'workbench_close', {}))
      .toEqual({ text: 'Workbench closed.', open: false, active: 'git' })
  })

  it('workbench_status reads the shared view without mutating it', async () => {
    const { ctx, service } = await harness()
    expect(await run(ctx, 'workbench_status', {}))
      .toEqual({ text: 'Workbench closed.', open: false })
    expect(service.open).not.toHaveBeenCalled()
    expect(service.close).not.toHaveBeenCalled()
  })

  it('reports an open workbench with no panel selected', async () => {
    const { ctx } = await harness()
    // Opening without a panel on a closed, unselected view commits `active: null`.
    expect(await run(ctx, 'workbench_open', {}))
      .toEqual({ text: 'Workbench opened; no panel selected.', open: true })
  })

  it('each call presents one generic card', async () => {
    const { ctx } = await harness()
    expect(ctx.tools.get('workbench_open')?.presentCall?.({ panel: 'files' }))
      .toMatchObject({ card: 'generic', title: 'Open the workbench', kind: 'execute' })
    expect(ctx.tools.get('workbench_close')?.presentCall?.({}))
      .toMatchObject({ card: 'generic', title: 'Close the workbench' })
    expect(ctx.tools.get('workbench_status')?.presentCall?.({}))
      .toMatchObject({ card: 'generic', title: 'Read the workbench state' })
  })
})
