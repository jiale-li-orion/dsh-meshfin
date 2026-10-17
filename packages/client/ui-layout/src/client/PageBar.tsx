/**
 * Page bar of a single-panel frame: one control per frame column, drawn in the
 * bottom row that hosts `shell.bottom`. The right control exists only while the
 * right panel's occupant is shown — the frame cannot open a column occupant for
 * a page nothing draws.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SinglePanelPage } from './columns.ts'
import type { LayoutKey } from './locales.ts'
import css from './PageBar.module.css'

/** Copy key of each page, in bar order. */
const PAGE_KEYS: Record<SinglePanelPage, LayoutKey> = {
  nav: 'page.nav',
  main: 'page.main',
  right: 'page.right',
}

/** Composed props: which page is showing, what the frame can offer, and the copy. */
export interface PageBarProps {
  /** The page currently showing. */
  page: SinglePanelPage
  /** Whether the right column's occupant is shown, which is the only thing that makes its page reachable. */
  rightShown: boolean
  /** Switch to another page. */
  onSelect: (page: SinglePanelPage) => void
  /** Translate seat of the `layout` dictionary. */
  t: TranslateNS<'layout'>
}

/**
 * Render the page switches.
 * @param props - the showing page, right-column eligibility, the switch, and the copy.
 * @returns the bar element.
 */
export function PageBar({ page, rightShown, onSelect, t }: PageBarProps) {
  const pages: SinglePanelPage[] = rightShown ? ['nav', 'main', 'right'] : ['nav', 'main']
  return (
    <nav className={css.bar} aria-label={t('page.label')} data-page-bar>
      {pages.map(key => (
        <button
          key={key}
          type="button"
          className={css.page}
          aria-current={key === page ? 'page' : undefined}
          onClick={() => { onSelect(key) }}
        >
          {t(PAGE_KEYS[key])}
        </button>
      ))}
    </nav>
  )
}
