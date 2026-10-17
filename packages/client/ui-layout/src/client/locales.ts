/** Copy owned by the layout frame: the single-panel page bar. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Page-bar copy for a frame below the single-panel breakpoint. */
    layout: LayoutKey
  }
}

/** Simplified Chinese page-bar copy; its key set is the dictionary's source of truth. */
export const zh = {
  'page.label': '切换页面',
  'page.nav': '导航',
  'page.main': '会话',
  'page.right': '右侧面板',
} satisfies Record<string, string>

/** One page-bar key. */
export type LayoutKey = keyof typeof zh

/** English page-bar copy. */
export const en: Record<LayoutKey, string> = {
  'page.label': 'Switch page',
  'page.nav': 'Navigation',
  'page.main': 'Conversation',
  'page.right': 'Right panel',
}
