/**
 * `workbench` namespace dictionaries.
 *
 * Two kinds of copy live here. The control row names the shared view and its one
 * panel; the preview names the file it cannot show, because "outside the
 * workspace", "deleted", and "unreachable" suggest different next steps.
 * @module @deepseek-ai/dsh-client-ui-workbench/client/locales
 */

/** Locale namespace owned by this package. */
export const NS = 'workbench'

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  title: '工作台',
  'panel.preview': '预览',
  'control.open': '打开面板',
  'control.toggle': '切换工作台',
  'control.close': '关闭工作台',
  'status.open': '已打开：{panel}',
  'status.closed': '已关闭',
  'path.label': '工作区文件路径',
  'path.placeholder': '例如 notes.md',
  'path.submit': '预览',
  'preview.empty': '还没有选择文件。',
  'preview.loading': '读取中…',
  'preview.media': '{name} 预览',
  'preview.unsupported': '这个格式没有可用的预览。',
  'error.forbidden': '无法读取：路径不在这个会话的工作区内。',
  'error.notFound': '文件不存在，可能已被移动或删除。',
  'error.unavailable': '读取失败：服务拒绝了这次请求。',
  'error.network': '读取失败：无法连接服务。',
} satisfies Record<string, string>

/** Workbench dictionary key union. */
export type WorkbenchKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  title: 'Workbench',
  'panel.preview': 'Preview',
  'control.open': 'Open panel',
  'control.toggle': 'Toggle workbench',
  'control.close': 'Close workbench',
  'status.open': 'Open: {panel}',
  'status.closed': 'Closed',
  'path.label': 'Workspace file path',
  'path.placeholder': 'For example notes.md',
  'path.submit': 'Preview',
  'preview.empty': 'No file selected yet.',
  'preview.loading': 'Reading...',
  'preview.media': 'Preview of {name}',
  'preview.unsupported': 'No preview is available for this format.',
  'error.forbidden': 'Cannot read it: the path is outside the workspace of this session.',
  'error.notFound': 'File not found. It may have been moved or deleted.',
  'error.unavailable': 'Read failed: the service refused the request.',
  'error.network': 'Read failed: the service is unreachable.',
} satisfies Record<WorkbenchKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Workbench tab copy: the control row, the shared view status, and the preview failures. */
    workbench: WorkbenchKey
  }
}
