// @vitest-environment jsdom
/** Context viewing-store selection, edit, and review actions. */

import { beforeEach, describe, expect, it } from 'vitest'
import { ContextUnitId } from '@deepseek-ai/dsh-session-context/brand'
import { createContextViewStore } from '../src/client/store.ts'

beforeEach(() => { localStorage.clear() })

describe('createContextViewStore', () => {
  it('supports one anchor, an extended interval, and a direct range through the current tail', () => {
    const instance = createContextViewStore().create('selection')
    const first = ContextUnitId('first')
    const middle = ContextUnitId('middle')
    const last = ContextUnitId('last')

    instance.actions.select(first, false)
    instance.actions.select(middle, true)
    expect(instance.store.getSnapshot()).toMatchObject({ anchorId: first, focusId: middle })

    instance.actions.selectRange(middle, last)
    expect(instance.store.getSnapshot()).toMatchObject({ anchorId: middle, focusId: last })

    instance.actions.clearSelection()
    expect(instance.store.getSnapshot()).toMatchObject({ anchorId: null, focusId: null })
  })

  it('closes durable review without dropping its identity or edited draft', () => {
    const instance = createContextViewStore().create('review')

    instance.actions.reviewPreparation('prep' as never, 'generated', true)
    instance.actions.setSummaryDraft('edited')
    instance.actions.closeReview()
    expect(instance.store.getSnapshot()).toMatchObject({
      reviewOpen: false,
      reviewPreparationId: 'prep',
      summaryDraft: 'edited',
    })

    instance.actions.openReview()
    expect(instance.store.getSnapshot().reviewOpen).toBe(true)
    instance.actions.clearReview()
    expect(instance.store.getSnapshot()).toMatchObject({
      reviewOpen: false,
      reviewPreparationId: null,
      summaryDraft: '',
    })
  })
})
