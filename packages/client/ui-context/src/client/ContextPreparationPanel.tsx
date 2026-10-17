/** Recoverable preparation and summary-review dialog for range compaction. */

import { Button, Modal, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContextPreparation } from '@deepseek-ai/dsh-session-context/types'
import type { SessionContextKey } from './locales.ts'
import css from './ContextPreparationPanel.module.css'

type Translate = (key: SessionContextKey, params?: Record<string, string | number>) => string

/** Props shared by preparation admission and durable review. */
export interface ContextPreparationPanelProps {
  prepareOpen: boolean
  reviewOpen: boolean
  brief: string
  selectedCount: number
  selectedTokens: number
  preparation: ContextPreparation | undefined
  summaryDraft: string
  busy: boolean
  canRegenerate: boolean
  operationError: string | null
  t: Translate
  onBrief: (brief: string) => void
  onClosePrepare: () => void
  onCloseReview: () => void
  onPrepare: () => void
  onSummary: (summary: string) => void
  onSave: () => void
  onCommit: () => void
  onDiscard: () => void
  onRegenerate: () => void
}

/** Label one preparation summary origin. */
function sourceLabel(preparation: ContextPreparation, t: Translate): string {
  if (preparation.summarySource === 'human') return t('review.human')
  if (preparation.summarySource === 'model') return t('review.model')
  return t('review.generated')
}

/** Label the durable preparation state without exposing internal event names. */
function reviewTitle(preparation: ContextPreparation, t: Translate): string {
  switch (preparation.status) {
    case 'preparing': return t('review.preparingTitle')
    case 'failed': return t('review.failed')
    case 'committing': return t('review.committingTitle')
    default: return t('review.title')
  }
}

/** Render preparation admission or the latest durable review in one modal. */
export function ContextPreparationPanel({
  prepareOpen,
  reviewOpen,
  brief,
  selectedCount,
  selectedTokens,
  preparation,
  summaryDraft,
  busy,
  canRegenerate,
  operationError,
  t,
  onBrief,
  onClosePrepare,
  onCloseReview,
  onPrepare,
  onSummary,
  onSave,
  onCommit,
  onDiscard,
  onRegenerate,
}: ContextPreparationPanelProps) {
  if (preparation === undefined) {
    return (
      <Modal
        open={prepareOpen}
        onClose={onClosePrepare}
        closeLabel={t('prepare.close')}
        title={t('prepare.title')}
        description={t('prepare.description')}
        footer={(
          <>
            <Button variant="outline" onClick={onClosePrepare}>{t('editor.cancel')}</Button>
            <Button variant="primary" onClick={onPrepare} disabled={busy || selectedCount === 0}>
              {busy ? t('prepare.running') : t('prepare.start')}
            </Button>
          </>
        )}
      >
        <div className={css.selectionSummary}>
          {t('selection.summary', { count: selectedCount, tokens: formatTokens(selectedTokens) })}
        </div>
        <label className={css.briefLabel}>
          <span>{t('prepare.brief')}</span>
          <textarea
            value={brief}
            placeholder={t('prepare.briefPlaceholder')}
            disabled={busy}
            onChange={(event) => { onBrief(event.currentTarget.value) }}
          />
        </label>
        {operationError !== null && <div className={css.failure}>{operationError}</div>}
      </Modal>
    )
  }

  const ready = preparation.status === 'ready'
  const failed = preparation.status === 'failed'
  const preparing = preparation.status === 'preparing'
  const committing = preparation.status === 'committing'
  const transitioning = busy && (preparation.status === 'discarded' || preparation.status === 'committed')
  const changed = ready && summaryDraft !== preparation.summary
  const showSummary = ready || preparation.summary.trim() !== ''
  const plan = preparation.plan
  return (
    <Modal
      open={reviewOpen}
      onClose={onCloseReview}
      closeLabel={t('review.closeDialog')}
      title={reviewTitle(preparation, t)}
      {...css.reviewDialog === undefined ? {} : { className: css.reviewDialog }}
      {...css.reviewContent === undefined ? {} : { contentClassName: css.reviewContent }}
      footer={(
        <div className={css.reviewFooter}>
          <Button variant="ghost" onClick={onCloseReview}>{t('review.close')}</Button>
          {(ready || failed) && (
            <Button variant="ghost" disabled={busy} onClick={onDiscard}>{t('review.discard')}</Button>
          )}
          {(ready || failed) && (
            <Button variant="outline" disabled={busy || !canRegenerate} onClick={onRegenerate}>
              {t('review.regenerate')}
            </Button>
          )}
          {ready && (
            <Button variant="outline" disabled={busy || !changed || summaryDraft.trim() === ''} onClick={onSave}>
              {t('review.save')}
            </Button>
          )}
          {ready && (
            <Button variant="primary" disabled={busy || summaryDraft.trim() === ''} onClick={onCommit}>
              {t('review.commit')}
            </Button>
          )}
        </div>
      )}
    >
      <div className={css.reviewBody}>
        <div className={css.reviewLead}>
          <div>
            <div className={css.reviewTitleLine}>
              <Pill>{sourceLabel(preparation, t)}</Pill>
              {plan !== undefined && (
                <Pill>{t(plan.strategy === 'direct' ? 'review.strategyDirect' : 'review.strategyMapReduce')}</Pill>
              )}
            </div>
            <p>{t('review.range', {
              start: preparation.startSeq,
              end: preparation.endSeq,
              units: preparation.unitCount,
              tokens: formatTokens(preparation.shadowedTokenCount),
            })}</p>
          </div>
          <p>{preparation.attemptedCalls === undefined
            ? t('review.progressUnknown', {
              completed: preparation.completedCalls,
              chunks: preparation.chunkCount,
            })
            : t('review.progress', {
              attempts: preparation.attemptedCalls,
              completed: preparation.completedCalls,
              chunks: preparation.chunkCount,
            })}</p>
        </div>

        {plan !== undefined && (
          <dl className={css.planGrid}>
            <div>
              <dt>{t('review.modelRoute')}</dt>
              <dd>{`${plan.provider} / ${plan.model}`}</dd>
            </div>
            <div>
              <dt>{t('review.contextWindow')}</dt>
              <dd>{formatTokens(plan.contextWindow)}</dd>
            </div>
            <div>
              <dt>{t('review.modelOutputLimit')}</dt>
              <dd>{plan.modelMaxOutputTokens === undefined
                ? t('review.unknown')
                : formatTokens(plan.modelMaxOutputTokens)}</dd>
            </div>
            <div>
              <dt>{t('review.inputBudget')}</dt>
              <dd>{t('review.inputBudgetValue', {
                input: formatTokens(plan.directInputTokens),
                budget: formatTokens(plan.inputTokenBudget),
              })}</dd>
            </div>
            <div>
              <dt>{t('review.outputCap')}</dt>
              <dd>{t('review.outputCapValue', {
                cap: formatTokens(plan.outputTokenCap),
                desired: formatTokens(plan.desiredOutputTokens),
              })}</dd>
            </div>
          </dl>
        )}

        {failed && preparation.error !== undefined && <div className={css.failure}>{preparation.error}</div>}
        {operationError !== null && operationError !== preparation.error && (
          <div className={css.failure}>{operationError}</div>
        )}
        {(preparing || committing || transitioning) && (
          <div className={css.pending}>{committing ? t('review.committing') : t('prepare.running')}</div>
        )}
        {failed && preparation.attemptedCalls !== undefined
          && preparation.attemptedCalls > preparation.completedCalls && (
          <div className={css.failureHint}>{t('review.failedAttempt', {
            attempts: preparation.attemptedCalls,
            completed: preparation.completedCalls,
          })}</div>
        )}
        {showSummary && (
          <label className={css.summaryLabel}>
            <span>{ready ? t('review.summary') : t('review.preservedSummary')}</span>
            <textarea
              className={css.summary}
              value={summaryDraft}
              readOnly={!ready}
              disabled={busy && ready}
              onChange={(event) => { onSummary(event.currentTarget.value) }}
            />
          </label>
        )}
      </div>
    </Modal>
  )
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1)}k`
  return String(tokens)
}
