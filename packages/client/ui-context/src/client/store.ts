/** Per-session Context view selection and editor state. */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { ContextPreparation, ContextRewriteMode, ContextUnitId } from '@deepseek-ai/dsh-session-context/types'

type CompactionPreparationId = ContextPreparation['preparationId']

/** Viewing state shared across Context view remounts in one Session. */
export interface ContextViewState {
  anchorId: ContextUnitId | null
  focusId: ContextUnitId | null
  detailId: ContextUnitId | null
  editorUnitId: ContextUnitId | null
  draft: string
  mode: ContextRewriteMode
  patchConfirmed: boolean
  prepareOpen: boolean
  reviewOpen: boolean
  preservationBrief: string
  reviewPreparationId: CompactionPreparationId | null
  summaryDraft: string
}

type ContextViewActions = {
  select: (draft: ContextViewState, unitId: ContextUnitId, extend: boolean) => void
  selectRange: (draft: ContextViewState, startId: ContextUnitId, endId: ContextUnitId) => void
  clearSelection: (draft: ContextViewState) => void
  showDetail: (draft: ContextViewState, unitId: ContextUnitId | null) => void
  beginEdit: (draft: ContextViewState, unitId: ContextUnitId, text: string) => void
  setDraft: (draft: ContextViewState, text: string) => void
  setMode: (draft: ContextViewState, mode: ContextRewriteMode) => void
  confirmPatch: (draft: ContextViewState, confirmed: boolean) => void
  closeEditor: (draft: ContextViewState) => void
  resetAfterRewrite: (draft: ContextViewState) => void
  openPreparation: (draft: ContextViewState) => void
  closePreparation: (draft: ContextViewState) => void
  setPreservationBrief: (draft: ContextViewState, brief: string) => void
  reviewPreparation: (
    draft: ContextViewState,
    preparationId: CompactionPreparationId,
    summary: string,
    open: boolean,
  ) => void
  trackPreparation: (draft: ContextViewState, preparationId: CompactionPreparationId, summary: string) => void
  openReview: (draft: ContextViewState) => void
  setSummaryDraft: (draft: ContextViewState, summary: string) => void
  closeReview: (draft: ContextViewState) => void
  clearReview: (draft: ContextViewState) => void
}

/**
 * Declare the per-session Context viewing store.
 * @returns a store handle mounted by the Context view registration.
 */
export function createContextViewStore(): EngineStoreHandle<ContextViewState, ContextViewActions> {
  return defineStore({
    init: (): ContextViewState => ({
      anchorId: null,
      focusId: null,
      detailId: null,
      editorUnitId: null,
      draft: '',
      mode: 'edit-and-continue',
      patchConfirmed: false,
      prepareOpen: false,
      reviewOpen: false,
      preservationBrief: '',
      reviewPreparationId: null,
      summaryDraft: '',
    }),
    persist: 'dsh.conversation.context',
    actions: {
      select: (draft, unitId, extend) => {
        if (!extend || draft.anchorId === null) draft.anchorId = unitId
        draft.focusId = unitId
      },
      selectRange: (draft, startId, endId) => {
        draft.anchorId = startId
        draft.focusId = endId
      },
      clearSelection: (draft) => {
        draft.anchorId = null
        draft.focusId = null
      },
      showDetail: (draft, unitId) => { draft.detailId = unitId },
      beginEdit: (draft, unitId, text) => {
        draft.editorUnitId = unitId
        draft.draft = text
        draft.mode = 'edit-and-continue'
        draft.patchConfirmed = false
      },
      setDraft: (draft, text) => { draft.draft = text },
      setMode: (draft, mode) => {
        draft.mode = mode
        draft.patchConfirmed = false
      },
      confirmPatch: (draft, confirmed) => { draft.patchConfirmed = confirmed },
      closeEditor: (draft) => {
        draft.editorUnitId = null
        draft.draft = ''
        draft.mode = 'edit-and-continue'
        draft.patchConfirmed = false
      },
      resetAfterRewrite: (draft) => {
        draft.anchorId = null
        draft.focusId = null
        draft.detailId = null
        draft.editorUnitId = null
        draft.draft = ''
        draft.mode = 'edit-and-continue'
        draft.patchConfirmed = false
      },
      openPreparation: (draft) => { draft.prepareOpen = true },
      closePreparation: (draft) => { draft.prepareOpen = false },
      setPreservationBrief: (draft, brief) => { draft.preservationBrief = brief },
      reviewPreparation: (draft, preparationId, summary, open) => {
        draft.reviewPreparationId = preparationId
        draft.summaryDraft = summary
        draft.prepareOpen = false
        draft.reviewOpen = open
      },
      trackPreparation: (draft, preparationId, summary) => {
        draft.reviewPreparationId = preparationId
        draft.summaryDraft = summary
      },
      openReview: (draft) => { draft.reviewOpen = true },
      setSummaryDraft: (draft, summary) => { draft.summaryDraft = summary },
      closeReview: (draft) => { draft.reviewOpen = false },
      clearReview: (draft) => {
        draft.reviewOpen = false
        draft.reviewPreparationId = null
        draft.summaryDraft = ''
        draft.preservationBrief = ''
      },
    },
  })
}
