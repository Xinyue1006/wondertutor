import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from './ui/Avatar'
import Icon from './ui/Icon'
import { Stars } from './ui/Common'
import './ParentReviewCarousel.css'

const REDUCED = '(prefers-reduced-motion: reduce)'
const HOVER_POINTER = '(hover: hover) and (pointer: fine)'
const query = value => typeof window.matchMedia === 'function' ? window.matchMedia(value) : null
const cardStep = track => (track.firstElementChild?.getBoundingClientRect().width || track.clientWidth)
  + (Number.parseFloat(window.getComputedStyle(track).columnGap) || 16)

export default function ParentReviewCarousel({ reviews = [] }) {
  const trackRef = useRef(null)
  const sectionRef = useRef(null)
  const trackId = useId()
  const titleId = useId()
  const hintId = useId()
  const [reduced, setReduced] = useState(() => query(REDUCED)?.matches ?? true)
  const [desktop, setDesktop] = useState(() => query(HOVER_POINTER)?.matches ?? false)
  const [inView, setInView] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [keyboardFocused, setKeyboardFocused] = useState(false)
  const [touching, setTouching] = useState(false)
  const [tabVisible, setTabVisible] = useState(() => document.visibilityState !== 'hidden')
  const [edges, setEdges] = useState({ start: true, end: true, scrollable: false })
  const lastEdges = useRef(null)

  // Stop an in-flight native smooth scroll as soon as someone starts reading.
  const freeze = useCallback(() => {
    const track = trackRef.current
    track?.scrollTo({ left: track.scrollLeft, behavior: 'instant' })
  }, [])

  useEffect(() => {
    const motion = query(REDUCED), pointer = query(HOVER_POINTER)
    const changed = () => {
      setReduced(motion?.matches ?? true)
      setDesktop(pointer?.matches ?? false)
      freeze()
    }
    for (const item of [motion, pointer]) {
      if (item?.addEventListener) item.addEventListener('change', changed)
      else item?.addListener?.(changed)
    }
    return () => {
      for (const item of [motion, pointer]) {
        if (item?.removeEventListener) item.removeEventListener('change', changed)
        else item?.removeListener?.(changed)
      }
    }
  }, [freeze])

  useEffect(() => {
    const changed = () => {
      setTabVisible(document.visibilityState !== 'hidden')
      if (document.visibilityState === 'hidden') freeze()
    }
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [freeze])

  useEffect(() => {
    const section = sectionRef.current
    if (!section || typeof IntersectionObserver !== 'function') return
    const observer = new IntersectionObserver(entries => {
      const visible = entries.some(entry => entry.isIntersecting)
      setInView(visible)
      if (!visible) freeze()
    }, { threshold: 0.15 })
    observer.observe(section)
    return () => observer.disconnect()
  }, [reviews.length, freeze])

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const measure = () => {
      const maximum = Math.max(0, track.scrollWidth - track.clientWidth)
      const next = { start: track.scrollLeft <= 1, end: track.scrollLeft >= maximum - 1, scrollable: maximum > 1 }
      const previous = lastEdges.current
      if (!previous || previous.start !== next.start || previous.end !== next.end || previous.scrollable !== next.scrollable) {
        lastEdges.current = next
        setEdges(next)
      }
    }
    measure()
    track.addEventListener('scroll', measure, { passive: true })
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(track)
    window.addEventListener('resize', measure, { passive: true })
    return () => { track.removeEventListener('scroll', measure); observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [reviews.length])

  useEffect(() => {
    if (!desktop || reduced || !inView || hovered || keyboardFocused || touching || !tabVisible || !edges.scrollable || reviews.length < 2) return
    const advance = () => {
      const track = trackRef.current
      if (!track) return
      const maximum = Math.max(0, track.scrollWidth - track.clientWidth)
      const left = track.scrollLeft >= maximum - 1 ? 0 : Math.min(maximum, track.scrollLeft + cardStep(track))
      track.scrollTo({ left, behavior: 'smooth' })
    }
    // Start promptly when visible, then leave time to read each set of cards.
    let interval
    const start = window.setTimeout(() => {
      advance()
      interval = window.setInterval(advance, 4000)
    }, 1000)
    return () => { window.clearTimeout(start); window.clearInterval(interval) }
  }, [desktop, reduced, inView, hovered, keyboardFocused, touching, tabVisible, edges.scrollable, reviews.length])

  function move(direction) {
    freeze()
    const track = trackRef.current
    if (!track) return
    const maximum = Math.max(0, track.scrollWidth - track.clientWidth)
    track.scrollTo({ left: Math.max(0, Math.min(maximum, track.scrollLeft + direction * cardStep(track))), behavior: reduced ? 'auto' : 'smooth' })
  }

  function onKeyDown(event) {
    if (event.target !== event.currentTarget) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      move(event.key === 'ArrowLeft' ? -1 : 1)
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      freeze()
      const track = trackRef.current
      track?.scrollTo({ left: event.key === 'Home' ? 0 : track.scrollWidth - track.clientWidth, behavior: reduced ? 'auto' : 'smooth' })
    }
  }

  if (!reviews.length) return null

  return (
    <section ref={sectionRef} aria-labelledby={titleId} className="home-reveal parent-reviews">
      <div className="parent-reviews-heading">
        <div>
          <p className="eyebrow">Shared learning experiences</p>
          <h2 id={titleId} className="section-title">What Parents Say</h2>
        </div>
      </div>
      <div className="parent-reviews-viewport"
        onMouseEnter={() => { setHovered(true); freeze() }} onMouseLeave={() => setHovered(false)}
        onFocusCapture={event => { if (event.target.matches(':focus-visible')) { setKeyboardFocused(true); freeze() } }}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocused(false) }}
        onKeyDownCapture={() => { setKeyboardFocused(true); freeze() }}
        onPointerDown={() => { setKeyboardFocused(false); freeze() }}
        onTouchStart={() => { setTouching(true); freeze() }} onTouchEnd={() => setTouching(false)} onTouchCancel={() => setTouching(false)}
        onWheel={freeze}>
        <ul id={trackId} ref={trackRef} aria-label="Parent reviews" aria-describedby={hintId} tabIndex={0} className="parent-reviews-track" onKeyDown={onKeyDown}>
          {reviews.map(review => <li key={review.id} className="parent-review-card">
            <div className="parent-review-author"><Avatar name={review.parentName} className="h-10 w-10" /><div><h3>{review.parentName}</h3><span aria-label={`Rated ${review.rating} out of 5`}><Stars value={review.rating} size="h-3.5 w-3.5" /></span></div><Icon name="book" className="ml-auto h-6 w-6 text-brand-200" /></div>
            <blockquote><p>{review.comment}</p></blockquote>
            <Link to={`/tutors/${review.tutorId}`} className="parent-review-tutor">View {review.tutorName}'s profile <Icon name="arrow-right" className="h-3.5 w-3.5" /></Link>
          </li>)}
        </ul>
        {reviews.length > 1 && <>
          <button type="button" className="parent-reviews-edge parent-reviews-edge--left" aria-label="Previous reviews" aria-controls={trackId} onClick={() => move(-1)} disabled={edges.start}><Icon name="arrow-left" /></button>
          <button type="button" className="parent-reviews-edge parent-reviews-edge--right" aria-label="Next reviews" aria-controls={trackId} onClick={() => move(1)} disabled={edges.end}><Icon name="arrow-right" /></button>
        </>}
      </div>
      <p id={hintId} className="sr-only">Use the arrow buttons or focus the reviews and press the Left and Right arrow keys. Swipe on touch screens.</p>
    </section>
  )
}
