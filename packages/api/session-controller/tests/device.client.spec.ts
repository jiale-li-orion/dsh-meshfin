// @vitest-environment jsdom
/**
 * Client device class: the three buckets a prompt may declare, and the
 * deliberate silence when there is no page to classify.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolvedClientDevice } from '../src/client/device.ts'

/** Install a page whose class the sampler can read. */
function sampleAs(options: {
  search?: string
  userAgentMobile?: boolean
  coarsePointer?: boolean
}): ReturnType<typeof resolvedClientDevice> {
  window.history.replaceState({}, '', options.search === undefined ? '/' : `/${options.search}`)
  Object.defineProperty(navigator, 'userAgentData', {
    configurable: true,
    value: { mobile: options.userAgentMobile as boolean },
  })
  // jsdom ships no matchMedia at all, so the sampler's optional call is what
  // this stands in for; the production path reads it defensively.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: options.coarsePointer ?? false, media: query }),
  })
  return resolvedClientDevice()
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'userAgentData')
  Reflect.deleteProperty(window, 'matchMedia')
})

describe('client device class', () => {
  it('reports the shell that says it is the app, whatever the screen reports', () => {
    // Only a shell can know it is an app; it says so on the URL it loads.
    expect(sampleAs({ search: '?dsh-shell=1', userAgentMobile: false })).toBe('mobile-app')
  })

  it('reports a mobile browser from the coarse platform signal', () => {
    expect(sampleAs({ userAgentMobile: true })).toBe('mobile-browser')
    expect(sampleAs({ coarsePointer: true })).toBe('mobile-browser')
  })

  it('reports a desktop browser when nothing says otherwise', () => {
    expect(sampleAs({ userAgentMobile: false })).toBe('desktop-browser')
  })

  it('falls back to the pointer when the platform signal is unavailable', () => {
    expect(sampleAs({ coarsePointer: false })).toBe('desktop-browser')
  })

  it('reports nothing when there is no page to classify', () => {
    // The runtime ships to non-browser callers too; a class it cannot know is
    // omitted rather than invented.
    vi.stubGlobal('window', undefined)
    expect(resolvedClientDevice()).toBeUndefined()
  })
})
