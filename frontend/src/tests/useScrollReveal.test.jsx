import { StrictMode, useRef } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import useScrollReveal from '../hooks/useScrollReveal'

let observers
let media

function Harness({ refreshKey = false, extra = false }) {
  const rootRef = useRef(null)
  useScrollReveal(rootRef, refreshKey)
  return (
    <main ref={rootRef}>
      <section className="home-reveal" data-top="100" aria-label="Initially visible">Visible heading</section>
      <section className="home-reveal" data-top="1200" aria-label="Later section"><button>Later action</button></section>
      {extra && <section className="home-reveal" data-top="1600" aria-label="Loaded tutors">Tutor cards</section>}
    </main>
  )
}

beforeEach(() => {
  observers = []
  const listeners = new Set()
  media = {
    matches: false,
    addEventListener: vi.fn((_, listener) => listeners.add(listener)),
    removeEventListener: vi.fn((_, listener) => listeners.delete(listener)),
    change(matches) { this.matches = matches; for (const listener of listeners) listener({ matches }) },
  }
  vi.stubGlobal('innerHeight', 800)
  vi.stubGlobal('matchMedia', vi.fn(() => media))
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback, options) {
      this.callback = callback
      this.options = options
      this.observe = vi.fn()
      this.unobserve = vi.fn()
      this.disconnect = vi.fn()
      observers.push(this)
    }
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const top = Number(this.getAttribute('data-top') || 0)
    return { top, bottom: top + 100, left: 0, right: 300, width: 300, height: 100, x: 0, y: top }
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test.each(['IntersectionObserver', 'matchMedia'])('unsupported %s keeps all content usable and visible', (api) => {
  vi.stubGlobal(api, undefined)
  render(<Harness />)
  expect(screen.getByRole('region', { name: 'Later section' })).not.toHaveAttribute('data-reveal-state', 'pending')
  expect(screen.getByRole('button', { name: 'Later action' })).toBeEnabled()
  expect(observers).toHaveLength(0)
})

test('does not hide content already in view; observes only the offscreen section', () => {
  render(<Harness />)
  const visible = screen.getByRole('region', { name: 'Initially visible' })
  const later = screen.getByRole('region', { name: 'Later section' })
  expect(visible).toHaveAttribute('data-reveal-state', 'visible')
  expect(later).toHaveAttribute('data-reveal-state', 'pending')
  expect(observers[0].observe).toHaveBeenCalledExactlyOnceWith(later)
})

test('reveals once when entering the viewport and does not hide when leaving', () => {
  render(<Harness />)
  const later = screen.getByRole('region', { name: 'Later section' })
  act(() => observers[0].callback([{ target: later, isIntersecting: true }]))
  expect(later).toHaveAttribute('data-reveal-state', 'visible')
  expect(observers[0].unobserve).toHaveBeenCalledWith(later)
  act(() => observers[0].callback([{ target: later, isIntersecting: false }]))
  expect(later).toHaveAttribute('data-reveal-state', 'visible')
})

test('late-loaded tutor cards are observed while already revealed sections stay visible', () => {
  const view = render(<Harness />)
  const later = screen.getByRole('region', { name: 'Later section' })
  act(() => observers[0].callback([{ target: later, isIntersecting: true }]))
  view.rerender(<Harness refreshKey extra />)
  const tutors = screen.getByRole('region', { name: 'Loaded tutors' })
  expect(later).toHaveAttribute('data-reveal-state', 'visible')
  expect(tutors).toHaveAttribute('data-reveal-state', 'pending')
  expect(observers[1].observe).toHaveBeenCalledExactlyOnceWith(tutors)
})

test('refreshing data does not prematurely reveal all still-offscreen content', () => {
  const view = render(<Harness />)
  view.rerender(<Harness refreshKey extra />)
  expect(screen.getByRole('region', { name: 'Later section' })).toHaveAttribute('data-reveal-state', 'pending')
  expect(observers[1].observe).toHaveBeenCalledTimes(2)
})

test('initial reduced-motion preference keeps everything visible without an observer', () => {
  media.matches = true
  render(<Harness />)
  expect(screen.getByRole('region', { name: 'Later section' })).toHaveAttribute('data-reveal-state', 'visible')
  expect(observers).toHaveLength(0)
})

test('turning reduced motion on immediately exposes pending content and stops observing', () => {
  render(<Harness />)
  const observer = observers[0]
  act(() => media.change(true))
  expect(screen.getByRole('region', { name: 'Later section' })).toHaveAttribute('data-reveal-state', 'visible')
  expect(observer.disconnect).toHaveBeenCalledOnce()
  act(() => media.change(false))
  expect(screen.getByRole('region', { name: 'Later section' })).toHaveAttribute('data-reveal-state', 'visible')
})

test('keyboard focus reveals an offscreen section immediately, before any intersection callback', () => {
  render(<Harness />)
  act(() => screen.getByRole('button', { name: 'Later action' }).focus())
  expect(screen.getByRole('button', { name: 'Later action' })).toHaveFocus()
  expect(screen.getByRole('region', { name: 'Later section' })).toHaveAttribute('data-reveal-state', 'visible')
})

test('cleanup exposes pending content, removes preference listener and ignores late observer delivery', () => {
  const view = render(<Harness />)
  const later = screen.getByRole('region', { name: 'Later section' })
  const observer = observers[0]
  view.unmount()
  expect(later).not.toHaveAttribute('data-reveal-state', 'pending')
  expect(observer.disconnect).toHaveBeenCalledOnce()
  expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  act(() => observer.callback([{ target: later, isIntersecting: true }]))
  expect(later).not.toHaveAttribute('data-reveal-state')
})

test('strict-mode setup cleanup leaves the active observer working', () => {
  render(<StrictMode><Harness /></StrictMode>)
  const later = screen.getByRole('region', { name: 'Later section' })
  expect(later).toHaveAttribute('data-reveal-state', 'pending')
  act(() => observers.at(-1).callback([{ target: later, isIntersecting: true }]))
  expect(later).toHaveAttribute('data-reveal-state', 'visible')
})

test('older media-query listener APIs still receive and clean up live preferences', () => {
  const listeners = new Set()
  media.addEventListener = undefined
  media.removeEventListener = undefined
  media.addListener = vi.fn(listener => listeners.add(listener))
  media.removeListener = vi.fn(listener => listeners.delete(listener))
  const view = render(<Harness />)
  act(() => { media.matches = true; for (const listener of listeners) listener({ matches: true }) })
  expect(screen.getByRole('region', { name: 'Later section' })).toHaveAttribute('data-reveal-state', 'visible')
  view.unmount()
  expect(media.removeListener).toHaveBeenCalledWith(expect.any(Function))
})
