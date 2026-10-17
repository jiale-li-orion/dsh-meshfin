/** Complete current-unit content rendered beside the virtualized Context list. */

import { useMemo, useState } from 'react'
import { Button, JsonTree, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { JsonTreeLabels, MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ContextHistoryReadResult,
  ContextHistorySearchResult,
  ContextUnitDetail as ContextUnitDetailValue,
} from '@deepseek-ai/dsh-session-context/types'
import type { SessionContextKey } from './locales.ts'
import css from './ContextUnitDetail.module.css'

type Translate = (key: SessionContextKey, params?: Record<string, string | number>) => string

/**
 * Cordis-free Markdown chrome copy for one locale revision.
 * @param t - this package's locale seat.
 * @returns fence and footnote labels.
 */
function markdownLabels(t: Translate): MarkdownLabels {
  return { code: { copyLabel: t('action.copy'), copiedLabel: t('action.copied') }, footnotes: t('markdown.footnotes') }
}

/**
 * Cordis-free JSON tree chrome copy for one locale revision.
 * @param t - this package's locale seat.
 * @returns row menu, copy, and expander labels.
 */
function jsonTreeLabels(t: Translate): JsonTreeLabels {
  return {
    copyValue: t('action.copyValue'),
    copyJson: t('action.copyJson'),
    copyPath: t('action.copyPath'),
    copyPrettyJson: t('action.copyPrettyJson'),
    copyCompactJson: t('action.copyCompactJson'),
    copied: t('action.copied'),
    copyFailed: t('action.copyFailed'),
    collapseNode: t('tree.collapse'),
    expandNode: t('tree.expand'),
    copyButtonTitle: action => t('action.copyHint', { action }),
  }
}

/** Render one model content block without exposing provider-private source state. */
type DetailBlock = ContextUnitDetailValue['messages'][number]['content'][number]

function Block({ block, t }: { block: DetailBlock; t: Translate }) {
  const markdown = useMemo(() => markdownLabels(t), [t])
  const json = useMemo(() => jsonTreeLabels(t), [t])
  switch (block.type) {
    case 'text':
      return <MarkdownText text={block.text} labels={markdown} />
    case 'reasoning':
      return (
        <div className={css.structured}>
          <strong>{t('details.reasoning')}</strong>
          <MarkdownText text={block.text} labels={markdown} />
        </div>
      )
    case 'image':
      return (
        <div className={css.image}>
          <span>{block.attachment.name ?? block.attachment.mediaType}</span>
          <span>{`${block.attachment.width} × ${block.attachment.height}`}</span>
        </div>
      )
    case 'file':
      return (
        <div className={css.image}>
          <span>{block.attachment.name}</span>
          <span>{t('details.fileBytes', { bytes: block.attachment.bytes })}</span>
        </div>
      )
    case 'tool-call':
      return (
        <div className={css.structured}>
          <strong>{t('details.toolCall', { name: block.name })}</strong>
          <code>{block.id}</code>
          <JsonTree data={treeData(safeJson(block.arguments))} label={t('details.toolArguments')} labels={json} />
        </div>
      )
    case 'tool-addition':
      return <div className={css.structured}><strong>{t('details.toolAddition', { name: block.toolName })}</strong></div>
    case 'tool-removal':
      return <div className={css.structured}><strong>{t('details.toolRemoval', { name: block.toolName })}</strong></div>
    default:
      // Merge-extensible union: an unknown block kind renders its own tag, not a
      // guess at content this package owns no presentation for.
      return <div className={css.structured}><code>{blockTag(block)}</code></div>
  }
}

/** Read the discriminant of a block kind this build does not know. */
function blockTag(block: DetailBlock): string {
  return typeof block === 'object' && block !== null && 'type' in block ? String(block.type) : 'unknown'
}

/** Parse Tool arguments for inspection while preserving malformed text. */
function safeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/** JsonTree requires an object root; wrap primitive or malformed arguments. */
function treeData(value: unknown): object | unknown[] {
  return typeof value === 'object' && value !== null ? value : { value }
}

/** Props for one detail drawer. */
export interface ContextUnitDetailProps {
  detail: ContextUnitDetailValue | undefined
  loading: boolean
  t: Translate
  onClose: () => void
  history: ContextHistoryReadResult | undefined
  historyLoading: boolean
  search: ContextHistorySearchResult | undefined
  searchLoading: boolean
  onReadHistory: (more: boolean) => void
  onSearchHistory: (query: string, more: boolean) => void
}

/** Render the selected unit's complete messages. */
export function ContextUnitDetail({
  detail,
  loading,
  t,
  onClose,
  history,
  historyLoading,
  search,
  searchLoading,
  onReadHistory,
  onSearchHistory,
}: ContextUnitDetailProps) {
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const checkpoint = detail?.unit.checkpointId
  return (
    <aside className={css.root} aria-label={t('details.title')}>
      <header className={css.header}>
        <h2>{t('details.title')}</h2>
        <Button size="sm" variant="toolbar" onClick={onClose}>{t('details.close')}</Button>
      </header>
      <div className={css.body}>
        {loading && <p className={css.status}>{t('details.loading')}</p>}
        {detail?.messages.map((message, messageIndex) => (
          <section key={messageIndex} className={css.message}>
            <div className={css.role}>{t(message.role === 'assistant' ? 'role.assistant' : 'role.user')}</div>
            <div className={css.content}>
              {message.content.map((block, blockIndex) => <Block key={blockIndex} block={block} t={t} />)}
            </div>
          </section>
        ))}
        {checkpoint !== undefined && (
          <section className={css.recall}>
            <h3>{t('recall.title')}</h3>
            <div className={css.recallActions}>
              {(history === undefined || history.nextCursor !== undefined) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={historyLoading}
                  onClick={() => { onReadHistory(history !== undefined) }}
                >
                  {historyLoading ? t('recall.loading') : history === undefined ? t('recall.load') : t('recall.more')}
                </Button>
              )}
              <div className={css.search}>
                <input
                  value={query}
                  placeholder={t('recall.searchPlaceholder')}
                  onChange={(event) => { setQuery(event.currentTarget.value) }}
                />
                <Button
                  size="sm"
                  variant="toolbar"
                  disabled={query.trim() === '' || searchLoading}
                  onClick={() => {
                    setSubmittedQuery(query)
                    onSearchHistory(query, false)
                  }}
                >
                  {searchLoading ? t('recall.searching') : t('recall.search')}
                </Button>
              </div>
            </div>
            {history !== undefined && history.entries.length > 0 && (
              <>
                <h4>{t('recall.originalMessages')}</h4>
                {history.entries.map((entry, index) => (
                  <pre key={`${entry.checkpointId}:${entry.seq}:${entry.offset}:${index}`} className={css.original}>
                    {entry.text}
                  </pre>
                ))}
              </>
            )}
            {search !== undefined && (
              <>
                <h4>{t('recall.searchResults', { count: search.matches.length })}</h4>
                {search.matches.length === 0 && <p className={css.status}>{t('recall.noMatches')}</p>}
                {search.matches.map((match, index) => (
                  <div key={`${match.checkpointId}:${match.seq}:${match.offset}:${index}`} className={css.match}>
                    {match.snippet}
                  </div>
                ))}
              </>
            )}
            {search?.nextCursor !== undefined && submittedQuery !== '' && (
              <Button
                size="sm"
                variant="outline"
                disabled={searchLoading}
                onClick={() => { onSearchHistory(submittedQuery, true) }}
              >
                {searchLoading ? t('recall.searching') : t('recall.searchMore')}
              </Button>
            )}
          </section>
        )}
      </div>
    </aside>
  )
}
