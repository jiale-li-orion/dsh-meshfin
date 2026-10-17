/**
 * Column geometry: the three-column solve, where the right column shrinks, then
 * loses its track, before the center drops below its minimum, and the
 * single-panel solve a frame below {@link SINGLE_PANEL_MAX} uses instead. The
 * sidebar never concedes here; AppFrame supplies its effective preference after
 * responsive collapse.
 */

/** Resolved widths for one frame. */
export interface Columns { sidebar: number; center: number; rightbar: number }

/** The one column a frame below {@link SINGLE_PANEL_MAX} shows, named by column. */
export type SinglePanelPage = 'nav' | 'main' | 'right'

/** Center width protected while the normal right column is open. */
export const CENTER_MIN = 400
/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 264
/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 420
/** Sidebar width before any user drag. */
export const SIDEBAR_DEFAULT = 280
/** Closed-sidebar rail: a 24px icon column between 16px horizontal paddings. */
export const SIDEBAR_COLLAPSED = 56
/** Viewport width below which the sidebar auto-collapses to the rail (deepsuite
 * LG breakpoint); a manual toggle below it re-expands over the squeezed center
 * (stores.ts narrowExpanded). */
export const SIDEBAR_AUTO_COLLAPSE = 1024
/** Frame width below which only one column renders at a time. It is the right
 * panel occupant's own automatic-fullscreen threshold, so the frame never asks
 * that column for a normal track below the width where its occupant stops
 * taking one. */
export const SINGLE_PANEL_MAX = 768
/** Right column drag clamp floor. */
export const RIGHTBAR_MIN = 300
/** Maximum normal right panel width as a fraction of the frame. */
export const RIGHTBAR_MAX_RATIO = 0.7
/** First-open right panel preference as a fraction of the frame. */
export const RIGHTBAR_DEFAULT_RATIO = 0.45

/**
 * Clamp a panel width into its contract range.
 * @param px - requested width.
 * @param min - range lower bound.
 * @param max - range upper bound.
 * @returns the clamped width.
 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)))
}

/**
 * Solve the three column widths for one viewport frame.
 * @param viewport - available frame width in px.
 * @param sidebar - sidebar width preference in px (0 = closed).
 * @param rightbar - requested right panel width in px (0 = no track).
 * @param collapsedWidth - track width of the closed sidebar; the default keeps
 *   the icon rail, 0 hides the column entirely (macOS desktop).
 * @returns actual widths after shrinking or removing the right track; only
 *   without that track may the center fall below its minimum, down to zero.
 */
export function computeColumns(viewport: number, sidebar: number, rightbar: number, collapsedWidth = SIDEBAR_COLLAPSED): Columns {
  const s = sidebar === 0 ? collapsedWidth : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const available = viewport - s - CENTER_MIN
  const r = rightbar === 0 || available < RIGHTBAR_MIN
    ? 0
    : Math.min(available, clampWidth(rightbar, RIGHTBAR_MIN, viewport * RIGHTBAR_MAX_RATIO))
  return { sidebar: s, center: Math.max(0, viewport - s - r), rightbar: r }
}

/**
 * Solve the single-panel frame: the page's column takes the whole width and the
 * other two resolve to zero, so their occupants keep their cells without
 * painting.
 * @param page - the page showing.
 * @param viewport - available frame width in px.
 * @returns column widths; only the named column is non-zero.
 */
export function computeSinglePanel(page: SinglePanelPage, viewport: number): Columns {
  return {
    sidebar: page === 'nav' ? viewport : 0,
    center: page === 'main' ? viewport : 0,
    rightbar: page === 'right' ? viewport : 0,
  }
}
