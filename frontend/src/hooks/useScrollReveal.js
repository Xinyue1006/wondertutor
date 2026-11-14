import { useEffect } from 'react'

// Content is visible by default. Only opt offscreen elements into a one-time
// entrance after the browser confirms it can observe them and motion is allowed.
export default function useScrollReveal(rootRef, refreshKey) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    let active = true
    let observer = null
    let media
    const targets = () => [...root.querySelectorAll('.home-reveal')]
    const reveal = (element) => {
      element.dataset.revealState = 'visible'
      observer?.unobserve(element)
    }
    const revealAll = () => targets().forEach(reveal)

    // Older browsers and blocked/unsupported media queries keep the normal page.
    if (typeof window.IntersectionObserver !== 'function' || typeof window.matchMedia !== 'function') return
    try { media = window.matchMedia('(prefers-reduced-motion: reduce)') } catch { return }

    const scan = () => {
      if (media.matches) {
        revealAll()
        observer?.disconnect()
        observer = null
        return
      }
      if (!observer) {
        observer = new window.IntersectionObserver((entries) => {
          if (!active) return
          for (const entry of entries) if (entry.isIntersecting) reveal(entry.target)
        }, { rootMargin: '0px 0px 48px 0px', threshold: 0.05 })
      }

      const viewportHeight = window.innerHeight || document.documentElement.clientHeight
      // Measure before changing styles, and never fade out content already in view
      // or being used by a keyboard visitor.
      const measured = targets().filter(element => element.dataset.revealState !== 'visible')
        .map(element => ({ element, top: element.getBoundingClientRect().top }))
      for (const { element, top } of measured) {
        if (top < viewportHeight || element.contains(document.activeElement)) reveal(element)
        else {
          element.dataset.revealState = 'pending'
          observer.observe(element)
        }
      }
    }

    const onFocus = (event) => {
      let element = event.target
      while (element && element !== root) {
        if (element.dataset?.revealState === 'pending') reveal(element)
        element = element.parentElement
      }
    }

    scan()
    root.addEventListener('focusin', onFocus)
    if (typeof media.addEventListener === 'function') media.addEventListener('change', scan)
    else media.addListener?.(scan)

    return () => {
      active = false
      observer?.disconnect()
      root.removeEventListener('focusin', onFocus)
      if (typeof media.removeEventListener === 'function') media.removeEventListener('change', scan)
      else media.removeListener?.(scan)
      // A refresh can re-arm these offscreen elements; an unmount/unsupported
      // follow-up leaves ordinary visible content rather than a hidden remnant.
      for (const element of targets()) if (element.dataset.revealState === 'pending') element.removeAttribute('data-reveal-state')
    }
  }, [rootRef, refreshKey])
}
