// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { ContextUnit, ContextUnitDetail } from '@deepseek-ai/dsh-session-context/types'
import { ContextEditor } from '../src/client/ContextEditor.tsx'
import { ContextMeterAction } from '../src/client/ContextMeterAction.tsx'
import { ContextPreparationPanel } from '../src/client/ContextPreparationPanel.tsx'
import { ContextUnitDetail as UnitDetail } from '../src/client/ContextUnitDetail.tsx'
import { ContextUnitRow } from '../src/client/ContextView.tsx'
import { ContextRewriteMarker } from '../src/client/context-rewrite-node.tsx'
import type { ContextRewriteMarkerProps } from '../src/client/context-rewrite-node.tsx'
import { zh } from '../src/client/locales.ts'
import type { ContextMeterActionProps } from '../src/client/ContextMeterAction.tsx'

afterEach(cleanup)

const t = makeTranslate(zh)

describe('Session Context components', () => {
  it('exposes an explicit selection check and direct edit action on each editable user prompt', () => {
    const unit: ContextUnit = {
      id: 'user-unit' as never,
      startSeq: SessionSeq(1),
      endSeq: SessionSeq(1),
      kind: 'message',
      role: 'user',
      tokenCount: 12,
      preview: 'original prompt',
      time: 1,
      balanced: true,
      editable: true,
    }
    const select = vi.fn()
    const clear = vi.fn()
    const edit = vi.fn()
    const detail = vi.fn()
    const view = render(<ContextUnitRow
      unit={unit}
      selected={false}
      editDisabled={false}
      t={t}
      onSelect={select}
      onClearSelection={clear}
      onEdit={edit}
      onDetail={detail}
    />)

    const check = screen.getByRole('button', { name: '选择用户 #1' })
    fireEvent.click(check)
    fireEvent.click(check, { shiftKey: true })
    expect(select.mock.calls).toEqual([[false], [true]])
    fireEvent.click(screen.getByRole('button', { name: '编辑这条用户提示词' }))
    expect(edit).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '查看完整内容' }))
    expect(detail).toHaveBeenCalledOnce()

    view.rerender(<ContextUnitRow
      unit={unit}
      selected
      editDisabled={false}
      t={t}
      onSelect={select}
      onClearSelection={clear}
      onEdit={edit}
      onDetail={detail}
    />)
    fireEvent.click(screen.getByRole('button', { name: '清除选择' }))
    expect(clear).toHaveBeenCalledOnce()
  })

  it('opens the Context view from the occupancy action', () => {
    const openContext = vi.fn()
    const props: ContextMeterActionProps = { openContext, t }
    render(<ContextMeterAction {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '管理上下文' }))
    expect(openContext).toHaveBeenCalledOnce()
  })

  it('gates patch submission behind its explicit causal-risk acknowledgement', () => {
    const submit = vi.fn()
    const onMode = vi.fn()
    const view = render(<ContextEditor
      open
      text="corrected"
      mode="patch"
      patchConfirmed={false}
      allowEmpty={false}
      busy={false}
      error={null}
      t={t}
      onText={vi.fn()}
      onMode={onMode}
      onPatchConfirmed={vi.fn()}
      onClose={vi.fn()}
      onSubmit={submit}
    />)
    const commit = screen.getByRole('button', { name: '确认保留后续回复' })
    expect(commit.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '编辑并继续' }))
    expect(onMode).toHaveBeenCalledWith('edit-and-continue')
    view.rerender(<ContextEditor
      open
      text="corrected"
      mode="patch"
      patchConfirmed
      allowEmpty={false}
      busy={false}
      error={null}
      t={t}
      onText={vi.fn()}
      onMode={onMode}
      onPatchConfirmed={vi.fn()}
      onClose={vi.fn()}
      onSubmit={submit}
    />)
    fireEvent.click(screen.getByRole('button', { name: '确认保留后续回复' }))
    expect(submit).toHaveBeenCalledOnce()
  })

  it('allows clearing prose when an authorized image remains and shows rewrite failure in the dialog', () => {
    render(<ContextEditor
      open
      text=""
      mode="patch"
      patchConfirmed
      allowEmpty
      busy={false}
      error="context tail changed"
      t={t}
      onText={vi.fn()}
      onMode={vi.fn()}
      onPatchConfirmed={vi.fn()}
      onClose={vi.fn()}
      onSubmit={vi.fn()}
    />)
    expect(screen.getByRole('button', { name: '确认保留后续回复' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('alert').textContent).toBe('context tail changed')
  })

  it('renders preparation admission and a ready editable review', () => {
    const prepare = vi.fn()
    const commit = vi.fn()
    const closeReview = vi.fn()
    const view = render(<ContextPreparationPanel
      prepareOpen
      reviewOpen={false}
      brief="keep literals"
      selectedCount={2}
      selectedTokens={120}
      preparation={undefined}
      summaryDraft=""
      busy={false}
      canRegenerate
      operationError={null}
      t={t}
      onBrief={vi.fn()}
      onClosePrepare={vi.fn()}
      onCloseReview={closeReview}
      onPrepare={prepare}
      onSummary={vi.fn()}
      onSave={vi.fn()}
      onCommit={commit}
      onDiscard={vi.fn()}
      onRegenerate={vi.fn()}
    />)
    expect(screen.getByText('已选 2 个单元，约 120 tokens')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '生成摘要' }))
    expect(prepare).toHaveBeenCalledOnce()

    view.rerender(<ContextPreparationPanel
      prepareOpen={false}
      reviewOpen
      brief="keep literals"
      selectedCount={2}
      selectedTokens={120}
      preparation={{
        preparationId: 'prep' as never,
        status: 'ready',
        startSeq: SessionSeq(1),
        endSeq: SessionSeq(2),
        unitCount: 2,
        shadowedTokenCount: 120,
        summary: 'generated summary',
        summarySource: 'generated',
        plan: {
          strategy: 'direct',
          provider: 'mock',
          model: 'model',
          contextWindow: 1_000_000,
          modelMaxOutputTokens: 256_000,
          desiredOutputTokens: 16_000,
          outputTokenCap: 16_000,
          directInputTokens: 400,
          inputTokenBudget: 984_000,
        },
        attemptedCalls: 2,
        completedCalls: 2,
        chunkCount: 2,
        createdAt: 1,
      }}
      summaryDraft="edited summary"
      busy={false}
      canRegenerate
      operationError={null}
      t={t}
      onBrief={vi.fn()}
      onClosePrepare={vi.fn()}
      onCloseReview={closeReview}
      onPrepare={prepare}
      onSummary={vi.fn()}
      onSave={vi.fn()}
      onCommit={commit}
      onDiscard={vi.fn()}
      onRegenerate={vi.fn()}
    />)
    expect(screen.getByDisplayValue('edited summary')).toBeTruthy()
    expect(screen.getByText('直接压缩')).toBeTruthy()
    expect(screen.getByText('完整请求约 400 / 可用 984k')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '提交压缩' }))
    expect(commit).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '稍后继续' }))
    expect(closeReview).toHaveBeenCalledOnce()
  })

  it('shows failed attempts and model budgets inside the recoverable review dialog', () => {
    render(<ContextPreparationPanel
      prepareOpen={false}
      reviewOpen
      brief=""
      selectedCount={0}
      selectedTokens={0}
      preparation={{
        preparationId: 'failed-prep' as never,
        status: 'failed',
        startSeq: SessionSeq(10),
        endSeq: SessionSeq(20),
        unitCount: 4,
        shadowedTokenCount: 155_000,
        summary: '',
        summarySource: 'generated',
        plan: {
          strategy: 'direct',
          provider: 'deepseek-official',
          model: 'deepseek-v4-pro',
          contextWindow: 1_000_000,
          modelMaxOutputTokens: 256_000,
          desiredOutputTokens: 38_750,
          outputTokenCap: 38_750,
          directInputTokens: 160_000,
          inputTokenBudget: 961_250,
        },
        attemptedCalls: 1,
        completedCalls: 0,
        chunkCount: 1,
        createdAt: 1,
        error: 'summarization truncated at the token cap',
      }}
      summaryDraft=""
      busy={false}
      canRegenerate
      operationError={null}
      t={t}
      onBrief={vi.fn()}
      onClosePrepare={vi.fn()}
      onCloseReview={vi.fn()}
      onPrepare={vi.fn()}
      onSummary={vi.fn()}
      onSave={vi.fn()}
      onCommit={vi.fn()}
      onDiscard={vi.fn()}
      onRegenerate={vi.fn()}
    />)

    expect(screen.getByText('尝试 1 次 · 完成 0 次 · 计划分片 1 个')).toBeTruthy()
    expect(screen.getByText('deepseek-official / deepseek-v4-pro')).toBeTruthy()
    expect(screen.getByText('summarization truncated at the token cap')).toBeTruthy()
  })

  it('renders complete unit blocks and checkpoint recall controls', () => {
    const detail: ContextUnitDetail = {
      unit: {
        id: 'unit' as never,
        startSeq: SessionSeq(1),
        endSeq: SessionSeq(1),
        kind: 'checkpoint',
        role: 'context',
        tokenCount: 10,
        preview: 'checkpoint',
        time: 1,
        balanced: true,
        editable: false,
        checkpointId: 'compact' as never,
      },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'summary body' }] }],
    }
    const read = vi.fn()
    const search = vi.fn()
    render(<UnitDetail
      detail={detail}
      loading={false}
      t={t}
      onClose={vi.fn()}
      history={{
        entries: [{ checkpointId: 'compact' as never, seq: SessionSeq(0), role: 'user', offset: 0, text: 'original body', complete: true }],
        nextCursor: 'next' as never,
        complete: false,
        returnedBytes: 100,
      }}
      historyLoading={false}
      search={{
        matches: [{ checkpointId: 'compact' as never, seq: SessionSeq(0), offset: 0, snippet: 'original match' }],
        nextCursor: 'search-next' as never,
        complete: false,
        scannedBytes: 20,
      }}
      searchLoading={false}
      onReadHistory={read}
      onSearchHistory={search}
    />)
    expect(screen.getByText('summary body')).toBeTruthy()
    expect(screen.getByText('original body')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '继续加载' }))
    expect(read).toHaveBeenCalledWith(true)
    fireEvent.change(screen.getByPlaceholderText('在原文中搜索'), { target: { value: 'original' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(search).toHaveBeenCalledWith('original', false)
    fireEvent.click(screen.getByRole('button', { name: '继续搜索' }))
    expect(search).toHaveBeenLastCalledWith('original', true)
  })

  it('renders the durable rewrite marker and opens Context', () => {
    const openContext = vi.fn()
    const props: ContextRewriteMarkerProps = {
      node: {
        key: 'rewrite',
        kind: 'context-rewrite',
        id: 'rewrite',
        target: 'chat',
        anchorSeq: 2,
        location: { kind: 'session' },
        visibility: 'visible',
        data: { mode: 'edit-and-continue', shadowedItemCount: 3, shadowedTokenCount: 40 },
      },
      openContext,
      t,
    }
    render(<ContextRewriteMarker {...props} />)
    expect(screen.getByText(/已移出后续 3 个上下文项/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看当前上下文' }))
    expect(openContext).toHaveBeenCalledOnce()
  })
})
