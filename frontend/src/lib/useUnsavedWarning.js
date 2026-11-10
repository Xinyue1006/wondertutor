// Asks before leaving with unsaved work: closing or reloading the tab, links clicked inside the app, and the browser's
// Back button. The app uses BrowserRouter, not a data router, so useBlocker is not available. Back is caught with a
// guard: one extra same-address history entry, so pressing Back only removes that entry and the page can ask first.
import { useEffect, useRef } from 'react'

export const UNSAVED = 'You have unsaved changes to your availability. Leave without saving?'

const pushGuard = () => window.history.pushState({ ...window.history.state, unsavedGuard: true }, '')

export function useUnsavedWarning(dirty) {
  const removal = useRef(null)

  useEffect(() => {
    if (!dirty) return
    // StrictMode runs cleanup and the effect again straight away: cancelling here keeps it to one guard entry
    clearTimeout(removal.current)

    const beforeUnload = (e) => e.preventDefault()
    const onLinkClick = (e) => {
      const link = e.target.closest?.('a[href]')
      if (!link || link.target === '_blank' || link.origin !== window.location.origin) return
      if (!window.confirm(UNSAVED)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    // Back has already removed the guard entry by the time this runs
    const onBack = () => {
      if (!window.confirm(UNSAVED)) {
        pushGuard()
        return
      }
      window.removeEventListener('popstate', onBack) // so leaving does not ask a second time
      window.history.back()
    }

    if (!window.history.state?.unsavedGuard) pushGuard()
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', onLinkClick, true) // capture: runs before the router handles the link
    window.addEventListener('popstate', onBack)

    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', onLinkClick, true)
      window.removeEventListener('popstate', onBack)
      // Take the extra entry away only if it is still the current one; after a confirmed link the router has moved on
      removal.current = setTimeout(() => {
        if (window.history.state?.unsavedGuard) window.history.back()
      })
    }
  }, [dirty])
}
