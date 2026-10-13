// Loads an external <script> once (Google sign-in, reCAPTCHA). Resolves when it is ready.
const cache = new Map()

export function loadScript(src) {
  if (cache.has(src)) return cache.get(src)
  const promise = new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.onload = resolve
    el.onerror = () => { cache.delete(src); reject(new Error(`Could not load ${src}`)) }
    document.head.appendChild(el)
  })
  cache.set(src, promise)
  return promise
}
