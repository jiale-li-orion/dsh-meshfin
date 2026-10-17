/** Virtualized current model-context view with bounded detail reads and same-Session rewrite. */

import { useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import clsx from 'clsx'
import {
  Button,
  IconCheckOutlineRegular,
  IconEditOutlineRegular,
  Pill,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContextUnit, ContextUnitDetail, ContextUnitId } from '@deepseek-ai/dsh-session-context/types'
// Type-only: projection key merges for request-envelope and capacity figures.
import type {} from '@deepseek-ai/dsh-token-meter/client'
import { ContextEditor } from './ContextEditor.tsx'
import { ContextPreparationPanel } from './ContextPreparationPanel.tsx'
import { ContextUnitDetail as UnitDetail } from './ContextUnitDetail.tsx'
import type { ContextControllerView } from './controller.ts'
import type { ContextViewProps } from './slots.ts'
import css from './ContextView.module.css'

/** Format a compact integer token estimate without locale-dependent grouping work per row. */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}m`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1)}k`
  return String(tokens)
}

/** Resolve a contiguous selection by stable unit ids. */
function selectedRange(
  units: readonly ContextUnit[],
  anchorId: ContextUnitId | null,
  focusId: ContextUnitId | null,
): { start: number; end: number; count: number; tokens: number; balanced: boolean } | null {
  if (anchorId === null || focusId === null) return null
  const anchor = units.findIndex(unit => unit.id === anchorId)
  const focus = units.findIndex(unit => unit.id === focusId)
  if (anchor < 0 || focus < 0) return null
  const start = Math.min(anchor, focus)
  const end = Math.max(anchor, focus)
  let tokens = 0
  let balanced = true
  for (let index = start; index <= end; index += 1) {
    const unit = units[index]
    tokens += unit?.tokenCount ?? 0
    if (unit?.balanced !== true) balanced = false
  }
  return { start, end, count: end - start + 1, tokens, balanced }
}

/** Flatten editable prose while the Host retains any image blocks authoritatively. */
function editableText(detail: ContextUnitDetail): string {
  return detail.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
    .join('\n\n')
}

/** Human label for one unit role. */
function roleLabel(unit: ContextUnit, t: ContextViewProps['t']): string {
  return t(unit.role === 'user' ? 'role.user' : unit.role === 'assistant' ? 'role.assistant' : 'role.context')
}

/** Human label for a non-default unit kind. */
function kindLabel(unit: ContextUnit, t: ContextViewProps['t']): string | null {
  if (unit.kind === 'tool-exchange') return t('kind.toolExchange')
  if (unit.kind === 'checkpoint') return t('kind.checkpoint')
  return null
}

/** Render one virtualized unit row. */
export function ContextUnitRow({
  unit,
  selected,
  editDisabled,
  t,
  onSelect,
  onClearSelection,
  onEdit,
  onDetail,
}: {
  unit: ContextUnit
  selected: boolean
  editDisabled: boolean
  t: ContextViewProps['t']
  onSelect: (extend: boolean) => void
  onClearSelection: () => void
  onEdit: (() => void) | undefined
  onDetail: () => void
}) {
  const kind = kindLabel(unit, t)
  const sequence = `${unit.startSeq}${unit.endSeq === unit.startSeq ? '' : `–${unit.endSeq}`}`
  return (
    <div className={clsx(css.unit, selected && css.unitSelected)} data-context-unit={unit.id}>
      <Tooltip label={selected ? t('selection.clear') : t('unit.select', {
        role: roleLabel(unit, t),
        seq: sequence,
      })} side="top" delayMs={300}>
        <button
          type="button"
          className={clsx(css.selectionToggle, selected && css.selectionToggleSelected)}
          aria-label={selected ? t('selection.clear') : t('unit.select', {
            role: roleLabel(unit, t),
            seq: sequence,
          })}
          aria-pressed={selected}
          onClick={(event) => {
            if (selected && !event.shiftKey) onClearSelection()
            else onSelect(event.shiftKey)
          }}
        >
          <span className={css.selectionMark}>{selected && <IconCheckOutlineRegular size={12} />}</span>
        </button>
      </Tooltip>
      <button
        type="button"
        className={css.unitSelect}
        aria-pressed={selected}
        onClick={(event) => { onSelect(event.shiftKey) }}
      >
        <span className={css.unitTopline}>
          <span className={css.role}>{roleLabel(unit, t)}</span>
          {kind !== null && <span className={css.kind}>{kind}</span>}
          <span className={css.seq}>{`#${sequence}`}</span>
          <span className={css.tokens}>{t('unit.tokens', { tokens: formatTokens(unit.tokenCount) })}</span>
        </span>
        <span className={css.preview}>{unit.preview}</span>
      </button>
      <div className={css.unitActions}>
        {onEdit !== undefined && (
          <Tooltip label={t('unit.editPrompt')} side="top" delayMs={300}>
            <button
              type="button"
              className={css.rowAction}
              aria-label={t('unit.editPrompt')}
              disabled={editDisabled}
              onClick={onEdit}
            >
              <IconEditOutlineRegular size={14} />
            </button>
          </Tooltip>
        )}
        <Tooltip label={t('unit.details')} side="top" delayMs={300}>
          <button type="button" className={css.rowAction} aria-label={t('unit.details')} onClick={onDetail}>•••</button>
        </Tooltip>
      </div>
    </div>
  )
}

/** Main Context view registration. */
export function ContextView({
  useSession,
  useProjection,
  useStore,
  actions,
  useController,
  activate,
  refresh,
  loadEarlier,
  readUnit,
  rewrite,
  prepare,
  editPreparation,
  discardPreparation,
  commitPreparation,
  readHistory,
  searchHistory,
  t,
}: ContextViewProps) {
  const controller = useController((value: ContextControllerView) => value)
  const running = useSession(snapshot => snapshot.running)
  const removed = useSession(snapshot => snapshot.removed)
  const breakdown = useProjection('contextBreakdown')
  const pressure = useProjection('contextPressure')
  const anchorId = useStore(state => state.anchorId)
  const focusId = useStore(state => state.focusId)
  const detailId = useStore(state => state.detailId)
  const editorUnitId = useStore(state => state.editorUnitId)
  const draft = useStore(state => state.draft)
  const mode = useStore(state => state.mode)
  const patchConfirmed = useStore(state => state.patchConfirmed)
  const prepareOpen = useStore(state => state.prepareOpen)
  const reviewOpen = useStore(state => state.reviewOpen)
  const preservationBrief = useStore(state => state.preservationBrief)
  const reviewPreparationId = useStore(state => state.reviewPreparationId)
  const summaryDraft = useStore(state => state.summaryDraft)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const preparationDialogOpenRef = useRef(prepareOpen || reviewOpen)
  const units = controller.context?.units ?? []
  const selection = useMemo(() => selectedRange(units, anchorId, focusId), [anchorId, focusId, units])
  const activePreparation = useMemo(() => [...(controller.context?.preparations ?? [])].reverse().find(preparation => (
    preparation.status === 'preparing'
      || preparation.status === 'ready'
      || preparation.status === 'failed'
      || preparation.status === 'committing'
  )), [controller.context?.preparations])
  const trackedPreparation = useMemo(() => reviewPreparationId === null
    ? undefined
    : controller.context?.preparations.find(preparation => preparation.preparationId === reviewPreparationId), [
    controller.context?.preparations,
    reviewPreparationId,
  ])
  const displayedPreparation = activePreparation ?? (reviewOpen ? trackedPreparation : undefined)

  useEffect(() => activate(), [activate])

  useEffect(() => {
    preparationDialogOpenRef.current = prepareOpen || reviewOpen
  }, [prepareOpen, reviewOpen])

  useEffect(() => {
    if (detailId === null || controller.details.has(detailId) || controller.detailLoading.has(detailId)) return
    void readUnit(detailId)
  }, [controller.detailLoading, controller.details, detailId, readUnit])

  useEffect(() => {
    if ((anchorId !== null && !units.some(unit => unit.id === anchorId))
      || (focusId !== null && !units.some(unit => unit.id === focusId))) {
      actions.clearSelection()
    }
    if (detailId !== null && !units.some(unit => unit.id === detailId)) actions.showDetail(null)
  }, [actions, anchorId, detailId, focusId, units])

  useEffect(() => {
    if (activePreparation === undefined) return
    if (reviewPreparationId !== activePreparation.preparationId) {
      actions.reviewPreparation(
        activePreparation.preparationId,
        activePreparation.summary,
        preparationDialogOpenRef.current,
      )
    } else if (activePreparation.status === 'ready' && summaryDraft === '' && activePreparation.summary !== '') {
      actions.trackPreparation(activePreparation.preparationId, activePreparation.summary)
    }
  }, [actions, activePreparation, reviewPreparationId, summaryDraft])

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: units.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 76,
    overscan: 8,
    getItemKey: index => units[index]?.id ?? index,
  })

  const openEditor = async (unit: ContextUnit): Promise<void> => {
    const result = await readUnit(unit.id)
    if (result.ok) actions.beginEdit(unit.id, editableText(result.value))
  }

  const submitRewrite = async (): Promise<void> => {
    if (editorUnitId === null) return
    const result = await rewrite({ unitId: editorUnitId, text: draft, mode })
    if (result.ok) actions.resetAfterRewrite()
  }

  const startPreparation = async (): Promise<void> => {
    if (selection === null) return
    const first = units[selection.start]
    const last = units[selection.end]
    if (first === undefined || last === undefined) return
    const result = await prepare({
      startUnitId: first.id,
      endUnitId: last.id,
      ...(preservationBrief.trim() === '' ? {} : { preservationBrief: preservationBrief.trim() }),
    })
    if (result.ok) {
      actions.reviewPreparation(
        result.value.preparationId,
        result.value.summary,
        preparationDialogOpenRef.current,
      )
    }
  }

  const savePreparation = async (): Promise<boolean> => {
    if (activePreparation === undefined || activePreparation.status !== 'ready') return false
    if (summaryDraft === activePreparation.summary) return true
    const result = await editPreparation({
      preparationId: activePreparation.preparationId,
      text: summaryDraft,
      source: 'human',
    })
    return result.ok
  }

  const commitReview = async (): Promise<void> => {
    if (activePreparation === undefined || !await savePreparation()) return
    const result = await commitPreparation({ preparationId: activePreparation.preparationId })
    if (result.ok) {
      actions.clearSelection()
      actions.clearReview()
    }
  }

  const discardReview = async (): Promise<void> => {
    if (activePreparation === undefined) return
    const result = await discardPreparation({ preparationId: activePreparation.preparationId })
    if (result.ok) actions.clearReview()
  }

  const regenerateReview = async (): Promise<void> => {
    if (activePreparation === undefined) return
    const first = units.find(unit => unit.startSeq === activePreparation.startSeq)
    const last = units.find(unit => unit.endSeq === activePreparation.endSeq)
    if (first === undefined || last === undefined) return
    const discarded = await discardPreparation({ preparationId: activePreparation.preparationId })
    if (!discarded.ok) return
    const result = await prepare({
      startUnitId: first.id,
      endUnitId: last.id,
      ...(activePreparation.preservationBrief === undefined
        ? {}
        : { preservationBrief: activePreparation.preservationBrief }),
    })
    if (result.ok) {
      actions.reviewPreparation(
        result.value.preparationId,
        result.value.summary,
        preparationDialogOpenRef.current,
      )
    }
  }

  const selectedUnit = selection?.count === 1 ? units[selection.start] : undefined
  const detail = detailId === null ? undefined : controller.details.get(detailId)
  const detailCheckpointId = detail?.unit.checkpointId
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  const contextWindow = pressure?.contextWindow
  const total = controller.context?.totalTokens ?? usedTokens
  const generation = controller.context?.replaceGeneration ?? 0
  const preparationBusy = controller.preparationOperation !== null
  const regenerationFirst = activePreparation === undefined
    ? undefined
    : units.find(unit => unit.startSeq === activePreparation.startSeq)
  const regenerationLast = activePreparation === undefined
    ? undefined
    : units.find(unit => unit.endSeq === activePreparation.endSeq)
  const canRegenerate = regenerationFirst !== undefined && regenerationLast !== undefined

  return (
    <div className={css.root}>
      <section className={css.main}>
        <header className={css.header}>
          <div>
            <div className={css.titleLine}>
              <h1>{t('view.context')}</h1>
              <Pill>{generation === 0 ? t('summary.initialGeneration') : t('summary.generation', { generation })}</Pill>
            </div>
            <p className={css.subtitle}>
              {controller.context?.route === undefined
                ? t('summary.units', { count: controller.context?.unitCount ?? units.length })
                : `${controller.context.route.provider} / ${controller.context.route.model} · ${t('summary.units', { count: controller.context.unitCount })}`}
            </p>
          </div>
          <div className={css.headerActions}>
            {activePreparation !== undefined && !reviewOpen && (
              <Button size="sm" variant="outline" onClick={actions.openReview}>
                {t(activePreparation.status === 'preparing'
                  ? 'review.openPreparing'
                  : activePreparation.status === 'failed'
                    ? 'review.openFailed'
                    : 'review.open')}
              </Button>
            )}
            <Button size="sm" variant="toolbar" onClick={() => { void refresh() }}>{t('status.refresh')}</Button>
          </div>
        </header>

        <div className={css.metrics}>
          <div className={css.metric}>
            <span>{t('summary.surface')}</span>
            <strong>{`~${formatTokens(controller.context?.surfaceTokens ?? breakdown?.messageTokens ?? 0)}`}</strong>
          </div>
          <div className={css.metric}>
            <span>{t('summary.system')}</span>
            <strong>{`~${formatTokens(breakdown?.systemTokens ?? 0)}`}</strong>
          </div>
          <div className={css.metric}>
            <span>{t('summary.tools')}</span>
            <strong>{`~${formatTokens(breakdown?.toolsTokens ?? 0)}`}</strong>
          </div>
          <div className={css.metric}>
            <span>{t('summary.total')}</span>
            <strong>
              {`~${formatTokens(total ?? 0)}${contextWindow === undefined ? '' : ` / ${formatTokens(contextWindow)}`}`}
            </strong>
          </div>
        </div>

        {controller.error !== null && (
          <div className={css.error} role="alert">
            <span>{controller.error}</span>
            <Button size="sm" variant="outline" onClick={() => { void refresh() }}>{t('status.retry')}</Button>
          </div>
        )}
        {running && <div className={css.notice}>{t('error.running')}</div>}
        {removed && <div className={css.notice}>{t('error.removed')}</div>}

        <ContextPreparationPanel
          prepareOpen={prepareOpen}
          reviewOpen={reviewOpen}
          brief={preservationBrief}
          selectedCount={selection?.count ?? 0}
          selectedTokens={selection?.tokens ?? 0}
          preparation={displayedPreparation}
          summaryDraft={summaryDraft}
          busy={preparationBusy}
          canRegenerate={canRegenerate}
          operationError={controller.error}
          t={t}
          onBrief={actions.setPreservationBrief}
          onClosePrepare={actions.closePreparation}
          onCloseReview={actions.closeReview}
          onPrepare={() => { void startPreparation() }}
          onSummary={actions.setSummaryDraft}
          onSave={() => { void savePreparation() }}
          onCommit={() => { void commitReview() }}
          onDiscard={() => { void discardReview() }}
          onRegenerate={() => { void regenerateReview() }}
        />

        {controller.status === 'loading' && controller.context === null && (
          <div className={css.centerStatus}>{t('status.loading')}</div>
        )}
        {controller.status === 'ready' && units.length === 0 && (
          <div className={css.centerStatus}>{t('status.empty')}</div>
        )}

        {units.length > 0 && (
          <div ref={scrollRef} className={css.list}>
            {controller.context?.hasEarlierUnits === true && (
              <div className={css.loadEarlier}>
                <Button
                  size="sm"
                  variant="toolbar"
                  disabled={controller.loadingEarlier}
                  onClick={() => { void loadEarlier() }}
                >
                  {controller.loadingEarlier ? t('status.loadingEarlier') : t('status.loadEarlier')}
                </Button>
              </div>
            )}
            <div className={css.virtualSpace} style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((virtual) => {
                const unit = units[virtual.index]
                if (unit === undefined) return null
                const isSelected = selection !== null
                  && virtual.index >= selection.start
                  && virtual.index <= selection.end
                return (
                  <div
                    key={unit.id}
                    ref={virtualizer.measureElement}
                    data-index={virtual.index}
                    className={css.virtualRow}
                    style={{ transform: `translateY(${virtual.start}px)` }}
                  >
                    <ContextUnitRow
                      unit={unit}
                      selected={isSelected}
                      editDisabled={running || removed || controller.rewriteUnitId !== null}
                      t={t}
                      onSelect={(extend) => { actions.select(unit.id, extend) }}
                      onClearSelection={actions.clearSelection}
                      onEdit={unit.editable ? () => { void openEditor(unit) } : undefined}
                      onDetail={() => { actions.showDetail(unit.id) }}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {selection !== null && (
          <footer className={css.selectionBar}>
            <span>
              {t('selection.summary', { count: selection.count, tokens: formatTokens(selection.tokens) })}
              {!selection.balanced && ` · ${t('selection.openTool')}`}
            </span>
            <div className={css.selectionActions}>
              <Button size="sm" variant="ghost" onClick={() => { actions.clearSelection() }}>
                {t('selection.clear')}
              </Button>
              {selection.end < units.length - 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const first = units[selection.start]
                    const last = units.at(-1)
                    if (first !== undefined && last !== undefined) actions.selectRange(first.id, last.id)
                  }}
                >
                  {t('selection.toEnd')}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={running || removed || !selection.balanced || preparationBusy || activePreparation !== undefined}
                onClick={actions.openPreparation}
              >
                {t('selection.compact')}
              </Button>
              {selectedUnit?.editable === true && (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={running || removed || controller.rewriteUnitId !== null}
                  onClick={() => { void openEditor(selectedUnit) }}
                >
                  {t('selection.edit')}
                </Button>
              )}
            </div>
          </footer>
        )}
      </section>

      {detailId !== null && (
        <UnitDetail
          detail={detail}
          loading={controller.detailLoading.has(detailId)}
          t={t}
          onClose={() => { actions.showDetail(null) }}
          history={detailCheckpointId === undefined ? undefined : controller.histories.get(detailCheckpointId)}
          historyLoading={detailCheckpointId !== undefined && controller.historyLoading.has(detailCheckpointId)}
          search={detailCheckpointId === undefined ? undefined : controller.searches.get(detailCheckpointId)}
          searchLoading={detailCheckpointId !== undefined && controller.searchLoading.has(detailCheckpointId)}
          onReadHistory={(more) => {
            if (detailCheckpointId !== undefined) void readHistory(detailCheckpointId, more)
          }}
          onSearchHistory={(query, more) => {
            if (detailCheckpointId !== undefined) void searchHistory(detailCheckpointId, query, more)
          }}
        />
      )}

      <ContextEditor
        open={editorUnitId !== null}
        text={draft}
        mode={mode}
        patchConfirmed={patchConfirmed}
        allowEmpty={editorUnitId !== null && controller.details.get(editorUnitId)?.messages
          .some(message => message.content.some(block => block.type === 'image')) === true}
        busy={controller.rewriteUnitId !== null}
        error={editorUnitId === null ? null : controller.error}
        t={t}
        onText={actions.setDraft}
        onMode={actions.setMode}
        onPatchConfirmed={actions.confirmPatch}
        onClose={actions.closeEditor}
        onSubmit={() => { void submitRewrite() }}
      />
    </div>
  )
}
