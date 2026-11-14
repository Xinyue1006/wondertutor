import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import ParentReviewCarousel from '../components/ParentReviewCarousel'

const reviews = [
  { id: 1, parentName: 'Parent A. T.', rating: 5, comment: 'Patient explanations helped our child understand fractions.', tutorId: 7, tutorName: 'Daniel Tan' },
  { id: 2, parentName: 'Parent S. L.', rating: 4, comment: 'The homework feedback was clear and useful.', tutorId: 8, tutorName: 'Lee Xin Yi' },
  { id: 3, parentName: 'Parent M. N.', rating: 5, comment: 'We appreciate the regular progress updates.', tutorId: 9, tutorName: 'Aisyah Rahman' },
]
let queries, intersections, scrolling, visibility

function media(matches) {
  const listeners = new Set()
  return {
    matches,
    addEventListener: vi.fn((_, listener) => listeners.add(listener)),
    removeEventListener: vi.fn((_, listener) => listeners.delete(listener)),
    change(value) { this.matches = value; listeners.forEach(listener => listener()) },
  }
}
const setup = (items = reviews) => render(<MemoryRouter><ParentReviewCarousel reviews={items} /></MemoryRouter>)
const track = () => screen.getByRole('list', { name: 'Parent reviews' })
const viewport = () => track().parentElement
const next = () => screen.getByRole('button', { name: 'Next reviews' })
const previous = () => screen.getByRole('button', { name: 'Previous reviews' })
const enter = () => act(() => intersections.at(-1)([{ isIntersecting: true }]))
const tick = milliseconds => act(() => vi.advanceTimersByTime(milliseconds))

beforeEach(() => {
  vi.useFakeTimers()
  queries = { reduced: media(false), desktop: media(true) }
  intersections = []
  visibility = 'visible'
  vi.stubGlobal('matchMedia', vi.fn(value => value.includes('prefers-reduced-motion') ? queries.reduced : queries.desktop))
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback) { intersections.push(callback) }
    observe() {}
    disconnect() {}
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320)
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(960)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const width = this.classList.contains('parent-review-card') ? 280 : 320
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 200, width, height: 200 }
  })
  scrolling = vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(function (options) {
    this.scrollLeft = options.left
    this.dispatchEvent(new Event('scroll'))
  })
})

afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

test('renders no invented testimonials when no reviews exist', () => {
  const { container } = setup([])
  expect(container).toBeEmptyDOMElement()
  tick(12000)
  expect(scrolling).not.toHaveBeenCalled()
})

test('shows complete supplied reviews and public links without visible instructions or playback controls', () => {
  setup()
  expect(screen.getByRole('heading', { name: 'What Parents Say' })).toBeVisible()
  reviews.forEach(review => expect(screen.getByText(review.comment)).toBeVisible())
  expect(screen.getByRole('link', { name: "View Daniel Tan's profile" })).toHaveAttribute('href', '/tutors/7')
  expect(screen.queryByText('Sample parent reviews for demonstration.')).not.toBeInTheDocument()
  expect(screen.queryByText(/^Hover over either edge to slide/i)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /play|pause/i })).not.toBeInTheDocument()
  expect(previous()).toBeDisabled()
  expect(next()).toBeEnabled()
})

test('desktop autoplay starts a second after becoming visible, advances every four seconds and wraps', () => {
  setup()
  tick(12000)
  expect(track().scrollLeft).toBe(0)
  enter(); tick(999)
  expect(track().scrollLeft).toBe(0)
  tick(1)
  expect(scrolling).toHaveBeenLastCalledWith({ left: 296, behavior: 'smooth' })
  tick(4000)
  expect(track().scrollLeft).toBe(592)
  tick(4000)
  expect(track().scrollLeft).toBe(640)
  tick(4000)
  expect(track().scrollLeft).toBe(0)
})

test('mouse hover holds the current position and leaving waits a fresh interval before sliding', () => {
  setup(); enter(); tick(1000)
  fireEvent.mouseEnter(viewport())
  const stoppedAt = track().scrollLeft
  tick(18000)
  expect(track().scrollLeft).toBe(stoppedAt)
  fireEvent.mouseLeave(viewport()); tick(999)
  expect(track().scrollLeft).toBe(stoppedAt)
  tick(1)
  expect(track().scrollLeft).toBeGreaterThan(stoppedAt)
})

test('clicking an arrow holds while hovered and resumes after the pointer leaves despite mouse focus', () => {
  setup(); enter()
  fireEvent.mouseEnter(viewport())
  const button = next(), matches = button.matches.bind(button)
  vi.spyOn(button, 'matches').mockImplementation(selector => selector === ':focus-visible' ? false : matches(selector))
  fireEvent.pointerDown(button)
  act(() => button.focus())
  fireEvent.click(button)
  expect(scrolling).toHaveBeenLastCalledWith({ left: 296, behavior: 'smooth' })
  tick(24000)
  expect(track().scrollLeft).toBe(296)
  fireEvent.mouseLeave(viewport()); tick(1000)
  expect(track().scrollLeft).toBe(592)
  fireEvent.mouseEnter(viewport())
  fireEvent.click(previous())
  expect(track().scrollLeft).toBe(296)
  tick(12000)
  expect(track().scrollLeft).toBe(296)
})

test('keyboard arrows, Home and End work without hijacking keys on a profile link', () => {
  setup(); enter()
  expect(track()).toHaveAttribute('tabindex', '0')
  expect(document.getElementById(track().getAttribute('aria-describedby'))).not.toBeNull()
  act(() => track().focus())
  fireEvent.keyDown(track(), { key: 'ArrowRight' })
  expect(track().scrollLeft).toBe(296)
  fireEvent.keyDown(track(), { key: 'End' })
  expect(track().scrollLeft).toBe(640)
  expect(next()).toBeDisabled()
  fireEvent.keyDown(track(), { key: 'ArrowLeft' })
  expect(track().scrollLeft).toBe(344)
  fireEvent.keyDown(track(), { key: 'Home' })
  expect(track().scrollLeft).toBe(0)
  fireEvent.keyDown(screen.getByRole('link', { name: "View Daniel Tan's profile" }), { key: 'ArrowRight' })
  expect(track().scrollLeft).toBe(0)
  tick(12000)
  expect(track().scrollLeft).toBe(0)
  act(() => track().blur())
  tick(1000)
  expect(track().scrollLeft).toBe(296)
})

test.each(['touch end', 'touch cancel'])('%s resumes after a temporary touch pause', ending => {
  setup(); enter(); tick(1000)
  fireEvent.touchStart(track())
  const stoppedAt = track().scrollLeft
  tick(12000)
  expect(track().scrollLeft).toBe(stoppedAt)
  if (ending === 'touch end') fireEvent.touchEnd(track())
  else fireEvent.touchCancel(track())
  tick(1000)
  expect(track().scrollLeft).toBeGreaterThan(stoppedAt)
})

test('wheel scrolling over reviews does not permanently disable autoplay after mouse leave', () => {
  setup(); enter(); tick(1000)
  fireEvent.mouseEnter(viewport())
  fireEvent.wheel(track())
  const stoppedAt = track().scrollLeft
  tick(12000)
  expect(track().scrollLeft).toBe(stoppedAt)
  fireEvent.mouseLeave(viewport()); tick(1000)
  expect(track().scrollLeft).toBeGreaterThan(stoppedAt)
})

test('keyboard focus pauses until focus leaves the review area', () => {
  setup(); enter(); tick(1000)
  const link = screen.getByRole('link', { name: "View Daniel Tan's profile" })
  const matches = link.matches.bind(link)
  vi.spyOn(link, 'matches').mockImplementation(selector => selector === ':focus-visible' ? true : matches(selector))
  act(() => link.focus())
  const stoppedAt = track().scrollLeft
  fireEvent.mouseLeave(viewport()); tick(12000)
  expect(track().scrollLeft).toBe(stoppedAt)
  act(() => link.blur())
  tick(1000)
  expect(track().scrollLeft).toBeGreaterThan(stoppedAt)
})

test.each(['hidden document', 'outside viewport'])('%s suspends sliding until visible again', reason => {
  setup(); enter(); tick(1000)
  if (reason === 'hidden document') {
    visibility = 'hidden'
    fireEvent(document, new Event('visibilitychange'))
  } else act(() => intersections.at(-1)([{ isIntersecting: false }]))
  const stoppedAt = track().scrollLeft
  tick(12000)
  expect(track().scrollLeft).toBe(stoppedAt)
  if (reason === 'hidden document') {
    visibility = 'visible'
    fireEvent(document, new Event('visibilitychange'))
  } else enter()
  tick(999)
  expect(track().scrollLeft).toBe(stoppedAt)
  tick(1)
  expect(track().scrollLeft).toBeGreaterThan(stoppedAt)
})

test.each(['mobile', 'reduced motion'])('%s keeps automatic movement off while manual navigation works', preference => {
  if (preference === 'mobile') queries.desktop.matches = false
  else queries.reduced.matches = true
  setup(); enter(); tick(18000)
  expect(track().scrollLeft).toBe(0)
  fireEvent.click(next())
  expect(scrolling).toHaveBeenLastCalledWith({ left: 296, behavior: preference === 'reduced motion' ? 'auto' : 'smooth' })
})

test('a live reduced-motion preference freezes automatic movement', () => {
  setup(); enter(); tick(1000)
  act(() => queries.reduced.change(true))
  const stoppedAt = track().scrollLeft
  tick(18000)
  expect(track().scrollLeft).toBe(stoppedAt)
  fireEvent.click(next())
  expect(scrolling).toHaveBeenLastCalledWith({ left: 592, behavior: 'auto' })
})

test('unmount clears pending rotation and removes preference listeners', () => {
  const view = setup(); enter()
  view.unmount()
  scrolling.mockClear()
  tick(18000)
  expect(scrolling).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  expect(queries.reduced.removeEventListener).toHaveBeenCalled()
  expect(queries.desktop.removeEventListener).toHaveBeenCalled()
})
