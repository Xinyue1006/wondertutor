import { useEffect, useRef } from 'react'
import { loadScript } from '../lib/loadScript'

export const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY

// grecaptcha.reset() without an id resets the first widget ever made, which is gone after a remount
let currentWidget = null
export function resetRecaptcha() {
  if (currentWidget !== null) window.grecaptcha?.reset(currentWidget)
}

// Google reCAPTCHA v2 checkbox. Renders nothing when no site key is configured (the backend then skips the check too).
export default function Recaptcha({ onToken, compact = false }) {
  const box = useRef(null)
  const widget = useRef(null)

  useEffect(() => {
    if (!RECAPTCHA_SITE_KEY) return
    let cancelled = false
    loadScript('https://www.google.com/recaptcha/api.js?render=explicit').then(() => {
      window.grecaptcha.ready(() => {
        if (cancelled || !box.current || widget.current !== null) return
        widget.current = window.grecaptcha.render(box.current, {
          sitekey: RECAPTCHA_SITE_KEY,
          size: compact ? 'compact' : 'normal',
          callback: onToken,
          'expired-callback': () => onToken(''),
        })
        currentWidget = widget.current
        onToken('') // a new, unticked widget: any token held from an earlier one is no longer valid
      })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return RECAPTCHA_SITE_KEY ? <div ref={box} className="min-h-[78px]" /> : null
}
