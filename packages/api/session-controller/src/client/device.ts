/** Browser-owned client-class sampling for prompt RPC provenance. */

import type { ClientDevice } from '@deepseek-ai/dsh-llm'

/**
 * Query key a phone shell loads its page with. Only a shell that knows it is an
 * app rather than a browser page can say so; nothing infers it.
 */
const SHELL_QUERY_KEY = 'dsh-shell'

/**
 * Report the class of the client making this call.
 *
 * Reads only coarse signals the page exposes to any stylesheet — a shell-declared
 * marker, `navigator.userAgentData.mobile`, and `(pointer: coarse)` — never a
 * device fingerprint. Undefined rather than a default outside a page: a runtime
 * that cannot know which client it is reports nothing, and the Host records no
 * class for that prompt instead of recording a guess.
 * @returns the device class this page reports, when it can tell.
 */
export function resolvedClientDevice(): ClientDevice | undefined {
  if (typeof window === 'undefined') return undefined
  if (new URLSearchParams(window.location.search).has(SHELL_QUERY_KEY)) return 'mobile-app'
  const chromiumMobile = (navigator as { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile
  // Not every runtime ships matchMedia (jsdom does not), so the guard is a
  // runtime check rather than an optional call the types already allow.
  const mediaQuery = window.matchMedia as ((query: string) => MediaQueryList) | undefined
  const coarse = mediaQuery === undefined ? false : mediaQuery('(pointer: coarse)').matches
  return (chromiumMobile ?? coarse) ? 'mobile-browser' : 'desktop-browser'
}
