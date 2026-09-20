/**
 * Model-facing workbench view controls over `ctx.workbench`. Each tool writes
 * the same shared view the browser renders and returns a model-facing notice;
 * none of them touches the browser directly, so a human gesture and a tool call
 * converge on one state and the `workbench/changed` event carries it to both.
 * @module @deepseek-ai/dsh-tool-workbench
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workbench'
import type { WorkbenchView } from '@deepseek-ai/dsh-workbench/types'

export const name = 'tool-workbench'
export const inject = ['tools', 'workbench']

/** Model-facing notice describing one committed view. */
function viewNotice(view: WorkbenchView): string {
  if (!view.open) return 'Workbench closed.'
  return view.active === null
    ? 'Workbench opened; no panel selected.'
    : `Workbench opened on panel "${view.active}".`
}

/** Result properties the three view-control tools share. */
const VIEW_PROPERTIES = {
  text: { type: 'string', required: true },
  open: { type: 'boolean', required: true },
  active: { type: 'string' },
} as const

/**
 * Model-facing output contract shared by the three workbench tools: one text
 * block carrying the rendered view, and nothing else.
 */
const VIEW_OUTPUT = {
  schema: { type: 'object' as const, additionalProperties: false, properties: VIEW_PROPERTIES },
  render: (_args: unknown, value: { text: string }) => [{ type: 'text' as const, text: value.text }],
}

/** One tool card per view-control call. */
function viewCall(title: string, rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind: 'execute', ...rawInput === undefined ? {} : { rawInput } }
}

/** The tool result for one committed view. */
function viewResult(view: WorkbenchView): { text: string; open: boolean; active?: string } {
  return {
    text: viewNotice(view),
    open: view.open,
    ...view.active === null ? {} : { active: view.active },
  }
}

/**
 * Register the three workbench view tools.
 * @param ctx - Cordis context carrying the tools registry and the workbench service.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'workbench_open',
    description: 'Open the shared workbench column, optionally selecting a panel by id. '
      + 'The human sees the column open on the same panel; this call starts nothing else.',
    parameters: {
      panel: { type: 'string', description: 'Panel id to select. Omit to keep the current selection.' },
    },
    output: VIEW_OUTPUT,
    execute(args) {
      return Promise.resolve(viewResult(ctx.workbench.open(args.panel ?? null)))
    },
    presentCall: args => viewCall('Open the workbench', args),
  })), 'tool-workbench: open')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'workbench_close',
    description: 'Close the shared workbench column. The selected panel is remembered for the next open.',
    parameters: {},
    output: VIEW_OUTPUT,
    execute() {
      return Promise.resolve(viewResult(ctx.workbench.close()))
    },
    presentCall: () => viewCall('Close the workbench'),
  })), 'tool-workbench: close')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'workbench_status',
    description: 'Read the shared workbench view: whether the column is open and which panel is selected.',
    parameters: {},
    output: VIEW_OUTPUT,
    execute() {
      return Promise.resolve(viewResult(ctx.workbench.state()))
    },
    presentCall: () => viewCall('Read the workbench state'),
  })), 'tool-workbench: status')
}
