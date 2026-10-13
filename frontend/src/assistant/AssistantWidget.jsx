// "Book Robot": floating bottom-right button + right-side chat panel (Parent Portal only).
// The chat is a GUIDED requirement-collection flow (quick-reply buttons + some free text).
// It is not an ML model: it fills the same criteria as the wizard and calls the same matching service.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Robot from '../components/ui/Robot'
import Icon from '../components/ui/Icon'
import { errorMessage } from '../api/client'
import { useMatching, EMPTY_CRITERIA } from './MatchingContext'
import { parseText } from './parseText'
import { DAY_SHORT, hhmmLabel } from '../lib/format'
import { gradeLabel, LEVELS, levelLabel } from '../lib/education'
import { TIME_PRESETS, defaultRange, rangeKey, rangeLabel } from '../lib/times'

let nextId = 1
const uid = () => nextId++

const BUDGETS = [
  { label: 'RM40 – RM60', min: 40, max: 60 },
  { label: 'RM60 – RM80', min: 60, max: 80 },
  { label: 'RM40 – RM80', min: 40, max: 80 },
  { label: 'No preference', min: null, max: null },
]

const budgetText = (c) =>
  c.budgetMax == null ? 'Any budget' : (c.budgetMin ?? 20) <= 20 ? `Up to RM${c.budgetMax}/hour` : `RM${c.budgetMin} – RM${c.budgetMax}/hour`

// The launcher can be dragged anywhere (mouse, touch or pen) so it never hides content the parent needs.
// A short tap still opens the chat; the arrow keys move it for keyboard users; the spot is remembered in this browser.
const POS_KEY = 'wt-assistant-pos'
const SIZE = 76
const MARGIN = 8
const DRAG_THRESHOLD = 6 // px of movement before a press counts as a drag rather than a tap

const clampPos = ({ right, bottom }) => ({
  right: Math.min(Math.max(right, MARGIN), window.innerWidth - SIZE - MARGIN),
  bottom: Math.min(Math.max(bottom, MARGIN), window.innerHeight - SIZE - MARGIN),
})

function loadPos() {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null')
    if (p && Number.isFinite(p.right) && Number.isFinite(p.bottom)) return clampPos(p)
  } catch { /* storage blocked or bad value: use the default corner */ }
  return { right: 16, bottom: 16 }
}

export default function AssistantWidget() {
  const { chatOpen, setChatOpen } = useMatching()
  const [bubble, setBubble] = useState(true)
  const [pos, setPos] = useState(loadPos)
  const [dragging, setDragging] = useState(false)
  const drag = useRef(null) // { x, y, start, moved }
  const suppressClick = useRef(false)

  const save = (p) => { try { localStorage.setItem(POS_KEY, JSON.stringify(p)) } catch { /* not remembered */ } }

  // Keep it on screen when the window gets smaller
  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return
    drag.current = { x: e.clientX, y: e.clientY, start: pos, moved: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  function onPointerMove(e) {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    if (!d.moved) { d.moved = true; setDragging(true); setBubble(false) }
    setPos(clampPos({ right: d.start.right - dx, bottom: d.start.bottom - dy }))
  }
  function onPointerUp() {
    const d = drag.current
    drag.current = null
    if (d?.moved) {
      suppressClick.current = true // the click that follows a drag must not open the chat
      setDragging(false)
      setPos((p) => { save(p); return p })
    }
  }
  function onClick() {
    if (suppressClick.current) { suppressClick.current = false; return }
    setChatOpen(!chatOpen)
  }
  function onKeyDown(e) {
    const step = e.shiftKey ? 64 : 16
    const move = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
    if (!move) return
    e.preventDefault()
    setPos((p) => { const next = clampPos({ right: p.right + move[0], bottom: p.bottom + move[1] }); save(next); return next })
  }

  // When the button sits on the left half of the screen, the greeting opens towards the right so it stays visible
  const onLeft = pos.right + SIZE / 2 > window.innerWidth / 2

  return (
    <>
      {chatOpen && <ChatPanel />}
      <div className={`fixed z-40 flex flex-col ${onLeft ? 'items-start' : 'items-end'}`} style={{ right: pos.right, bottom: pos.bottom }}>
        {bubble && !chatOpen && !dragging && (
          <div className={`pop-in relative mb-1 w-48 rounded-xl bg-white px-3 py-2 text-left shadow-lg ring-1 ring-brand-100 ${onLeft ? 'ml-2' : 'mr-2'}`}>
            <button onClick={() => setBubble(false)} className="absolute right-1.5 top-1.5 text-slate-400 hover:text-slate-600" aria-label="Dismiss">
              <Icon name="x" className="h-3.5 w-3.5" />
            </button>
            <div className="text-xs font-bold text-navy">AI Tutor Assistant</div>
            <div className="text-xs text-slate-600">Hi! How can I help you today?</div>
            <span className={`absolute -bottom-1.5 h-3 w-3 rotate-45 bg-white ring-1 ring-brand-100 [clip-path:polygon(100%_0,100%_100%,0_100%)] ${onLeft ? 'left-8' : 'right-8'}`} />
          </div>
        )}
        <button
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={onClick}
          onKeyDown={onKeyDown}
          title="Drag to move. Click to chat."
          className={`flex h-[76px] w-[76px] touch-none select-none items-center justify-center rounded-full bg-white shadow-xl ring-2 ring-brand-100 transition-transform ${
            dragging ? 'scale-105 cursor-grabbing' : 'float-y cursor-grab hover:scale-105'
          }`}
          aria-label={chatOpen ? 'Close AI Tutor Assistant' : 'Open AI Tutor Assistant (use the arrow keys to move this button)'}
        >
          <Robot className="pointer-events-none h-[62px] w-[62px]" />
        </button>
      </div>
    </>
  )
}

// ───────────── chat panel ─────────────

function ChatPanel() {
  const m = useMatching()
  const navigate = useNavigate()
  const { catalog, kids, kidsLoaded, criteria, setCriteria, setChatOpen } = m
  const [messages, setMessages] = useState([])
  const [asked, setAsked] = useState({})
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const scroller = useRef(null)
  const started = useRef(false)

  // The conversation lives for as long as the portal is open; closing the panel just hides it
  useEffect(() => {
    if (started.current || !catalog || !kidsLoaded) return
    started.current = true
    const first = nextStep(criteria, {}, kids)
    setMessages([
      {
        id: uid(), from: 'bot',
        text: "Hi! 👋 I can help you find a suitable tutor for your child. You can describe your needs naturally, and I'll help turn them into matching preferences.",
      },
      stepMessage(first, criteria, kids, catalog),
    ])
  }, [catalog, kidsLoaded, criteria, kids])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const push = (...msgs) => setMessages((prev) => [...prev, ...msgs])
  const markAnswered = (id) => setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, answered: true } : x)))

  // After every answer: work out what is still missing and ask the next question
  function advance(c, flags) {
    setAsked(flags)
    const step = nextStep(c, flags, kids)
    push(stepMessage(step, c, kids, catalog))
  }

  function answer(msg, patch, label, flagKey) {
    const c = { ...criteria, ...patch }
    setCriteria(c)
    markAnswered(msg.id)
    push({ id: uid(), from: 'user', text: label })
    advance(c, { ...asked, ...(flagKey && { [flagKey]: true }) })
  }

  function onSend(e) {
    e.preventDefault()
    const value = text.trim()
    if (!value) return
    setText('')
    const { found, notes } = parseText(value, catalog)
    push({ id: uid(), from: 'user', text: value })
    if (!notes.length && !Object.keys(found).length) {
      push({ id: uid(), from: 'bot', text: "Sorry, I didn't catch that. You can pick one of the options above, or tell me things like “Maths, Primary 5, Mon & Fri evenings, online, under RM70”." })
      return
    }
    const c = { ...criteria, ...found }
    setCriteria(c)
    // Anything mentioned in free text doesn't need to be asked again
    const flags = {
      ...asked,
      ...(found.days && { daysAsked: true }),
      ...(found.mode && { modeAsked: true }),
      ...(found.location && { locAsked: true }),
      ...(found.budgetMax != null && { budgetAsked: true }),
    }
    // The pending quick-reply question may have just been answered in free text: retire it
    setMessages((prev) => prev.map((x) => (x.step && !x.answered && x.step !== 'summary' ? { ...x, answered: true } : x)))
    push({ id: uid(), from: 'bot', text: `Got it! I noted: ${notes.join(' · ')}.` })
    advance(c, flags)
  }

  async function findMatches() {
    setBusy(true)
    try {
      await m.runMatching('CHATBOT', criteria)
      navigate('/parent/find-tutor/results')
    } catch (err) {
      push({ id: uid(), from: 'bot', text: `Sorry, I couldn't run the search: ${errorMessage(err)}` })
    } finally {
      setBusy(false)
    }
  }

  function edit() {
    setChatOpen(false)
    navigate('/parent/find-tutor/match')
  }

  function restart() {
    setCriteria(EMPTY_CRITERIA)
    setAsked({})
    const first = nextStep(EMPTY_CRITERIA, {}, kids)
    setMessages([{ id: uid(), from: 'bot', text: "No problem, let's start again." }, stepMessage(first, EMPTY_CRITERIA, kids, catalog)])
  }

  return (
    <aside className="pop-in fixed bottom-28 right-4 top-24 z-40 flex w-[min(390px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-brand-100">
      <header className="flex items-center gap-3 bg-gradient-to-r from-brand-50 to-white px-4 py-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow ring-1 ring-brand-100">
          <Robot className="h-10 w-10" sparkles={false} />
        </span>
        <div className="flex-1">
          <div className="text-lg font-extrabold text-navy">AI Tutor Assistant</div>
          <div className="text-xs text-slate-500">Your learning matchmaker</div>
        </div>
        <button onClick={restart} title="Start over" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Start over">
          <Icon name="refresh" className="h-[18px] w-[18px]" />
        </button>
        <button onClick={() => setChatOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Minimise">
          <Icon name="minus" className="h-[18px] w-[18px]" />
        </button>
        <button onClick={() => setChatOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close">
          <Icon name="x" className="h-[18px] w-[18px]" />
        </button>
      </header>

      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto bg-brand-25 px-4 py-4">
        {messages.map((msg) => (
          <Message key={msg.id} msg={msg} c={criteria} catalog={catalog} kids={kids} onAnswer={answer} onFind={findMatches} onEdit={edit} busy={busy} setCriteria={setCriteria} />
        ))}
      </div>

      <form onSubmit={onSend} className="flex items-center gap-2 border-t border-slate-100 bg-white p-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type your message..."
          className="input h-11 flex-1"
        />
        <button className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-500 text-white shadow hover:bg-brand-600" aria-label="Send">
          <Icon name="send" className="h-[18px] w-[18px]" />
        </button>
      </form>
    </aside>
  )
}

// ───────────── conversation logic ─────────────

function nextStep(c, flags, kids) {
  if (kids.length && !flags.childAsked && !c.childId) return 'child'
  if (!c.subject) return 'subject'
  if (!c.level) return 'level'
  if (!c.grade && c.level !== 'KINDERGARTEN') return 'grade'
  if (!flags.daysAsked) return 'days'
  if (!flags.modeAsked) return 'mode'
  if (c.mode !== 'ONLINE' && !flags.locAsked && !c.location) return 'location'
  if (!flags.budgetAsked) return 'budget'
  return 'summary'
}

const QUESTIONS = {
  child: 'Which child is this for?',
  subject: 'What subject does your child need help with?',
  level: 'Great! What education level is your child studying?',
  days: 'Got it! When would you prefer the lessons?',
  mode: 'Would you like online or physical lessons?',
  location: 'Which area should the tutor be near?',
  budget: "What's your budget per hour?",
}

function stepMessage(step, c, kids, catalog) {
  if (step === 'grade') return { id: uid(), from: 'bot', step, text: `Which year is your child in (${levelLabel(c.level)})?` }
  return { id: uid(), from: 'bot', step, text: QUESTIONS[step] }
}

// ───────────── message rendering ─────────────

function BotAvatar() {
  return (
    <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-brand-100">
      <Robot className="h-6 w-6" sparkles={false} />
    </span>
  )
}

function Message({ msg, c, catalog, kids, onAnswer, onFind, onEdit, busy, setCriteria }) {
  if (msg.from === 'user') {
    return (
      <div className="flex items-center justify-end gap-2">
        <div className="rounded-xl bg-brand-100 px-3.5 py-2 text-sm text-navy">{msg.text}</div>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-white">
          <Icon name="user" className="h-4 w-4" />
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2">
      <BotAvatar />
      <div className="min-w-0 flex-1">
        {msg.text && <div className="rounded-xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm text-slate-700 shadow-sm ring-1 ring-brand-100">{msg.text}</div>}
        {msg.step && !msg.answered && (
          <StepInput msg={msg} c={c} catalog={catalog} kids={kids} onAnswer={onAnswer} setCriteria={setCriteria} />
        )}
        {msg.step === 'summary' && <Summary c={c} onFind={onFind} onEdit={onEdit} busy={busy} />}
      </div>
    </div>
  )
}

function Chips({ options, onPick }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o.label} type="button" onClick={() => onPick(o)} className="chip px-3.5 py-1.5 text-[13px]">
          {o.label}
        </button>
      ))}
    </div>
  )
}

function StepInput({ msg, c, catalog, kids, onAnswer }) { // eslint-disable-line no-unused-vars
  switch (msg.step) {
    case 'child':
      return (
        <Chips
          options={[...kids.map((k) => ({ label: `${k.name} (${gradeLabel(k.educationLevel, k.grade)})`, child: k })), { label: 'Someone else' }]}
          onPick={(o) =>
            o.child
              ? onAnswer(msg, { childId: o.child.id, level: o.child.educationLevel, grade: o.child.grade, subject: o.child.subject || c.subject }, o.child.name, 'childAsked')
              : onAnswer(msg, {}, o.label, 'childAsked')
          }
        />
      )
    case 'subject':
      return <Chips options={(catalog?.subjects || []).map((s) => ({ label: s }))} onPick={(o) => onAnswer(msg, { subject: o.label }, o.label)} />
    case 'level':
      return <Chips options={LEVELS.map((l) => ({ label: l.value === 'SECONDARY' ? 'Secondary' : l.label, value: l.value }))} onPick={(o) => onAnswer(msg, { level: o.value }, o.label)} />
    case 'grade': {
      const max = LEVELS.find((l) => l.value === c.level)?.max || 6
      return (
        <Chips
          options={Array.from({ length: max }, (_, i) => ({ label: gradeLabel(c.level, i + 1), value: i + 1 }))}
          onPick={(o) => onAnswer(msg, { grade: o.value }, o.label)}
        />
      )
    }
    case 'days':
      return <DaysInput msg={msg} c={c} onAnswer={onAnswer} />
    case 'mode':
      return (
        <Chips
          options={[{ label: 'Online', value: 'ONLINE' }, { label: 'Physical', value: 'PHYSICAL' }, { label: 'Either', value: 'EITHER' }]}
          onPick={(o) => onAnswer(msg, { mode: o.value }, o.label, 'modeAsked')}
        />
      )
    case 'location':
      return (
        <select
          className="input mt-2 h-10 text-sm"
          defaultValue=""
          onChange={(e) => e.target.value && onAnswer(msg, { location: e.target.value }, e.target.value, 'locAsked')}
        >
          <option value="" disabled>Choose an area…</option>
          {(catalog?.locations || []).map((l) => <option key={l}>{l}</option>)}
        </select>
      )
    case 'budget':
      return (
        <Chips
          options={BUDGETS}
          onPick={(o) => onAnswer(msg, { budgetMin: o.min, budgetMax: o.max }, o.label, 'budgetAsked')}
        />
      )
    default:
      return null
  }
}

// Preferred days (multi-select chips) + time window dropdown, as in the mockup
function DaysInput({ msg, c, onAnswer }) {
  const [days, setDays] = useState(c.days || [])
  const [preset, setPreset] = useState(c.timePreset || 'EVENING')
  const [range, setRange] = useState(c.timeStart ? [c.timeStart, c.timeEnd] : defaultRange(preset))
  const toggle = (d) => setDays((x) => (x.includes(d) ? x.filter((v) => v !== d) : [...x, d].sort()))
  const order = [1, 2, 3, 4, 5, 6, 0]

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {order.map((d) => (
          <button key={d} type="button" onClick={() => toggle(d)} className={`chip px-3 py-1.5 text-[13px] ${days.includes(d) ? 'chip-on' : ''}`}>
            {DAY_SHORT[d]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Icon name="clock" className="h-4 w-4 text-brand-500" />
        <select
          className="input h-10 flex-1 text-sm"
          value={rangeKey(...range)}
          onChange={(e) => {
            const [s, en] = e.target.value.split('-')
            setRange([s, en])
            setPreset(Object.keys(TIME_PRESETS).find((k) => TIME_PRESETS[k].ranges.some(([a, b]) => a === s && b === en)) || preset)
          }}
        >
          {Object.entries(TIME_PRESETS).map(([k, p]) => (
            <optgroup key={k} label={p.label}>
              {p.ranges.map(([s, e]) => <option key={rangeKey(s, e)} value={rangeKey(s, e)}>{rangeLabel(s, e)}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary px-4 py-1.5 text-[13px]"
          onClick={() =>
            onAnswer(
              msg,
              { days, timePreset: preset, timeStart: range[0], timeEnd: range[1] },
              days.length ? `${days.map((d) => DAY_SHORT[d]).join(', ')} · ${hhmmLabel(range[0])} – ${hhmmLabel(range[1])}` : 'Any day',
              'daysAsked',
            )
          }
        >
          {days.length ? 'Done' : 'No preference'}
        </button>
      </div>
    </div>
  )
}

function Summary({ c, onFind, onEdit, busy }) {
  const rows = [
    ['book', [c.subject, c.level && (c.grade ? gradeLabel(c.level, c.grade) : levelLabel(c.level))].filter(Boolean).join(' • ')],
    c.days.length || c.timeStart
      ? ['calendar', `${c.days.map((d) => DAY_SHORT[d]).join(' & ') || 'Any day'}${c.timeStart ? ` • ${hhmmLabel(c.timeStart)} - ${hhmmLabel(c.timeEnd)}` : ''}`]
      : null,
    ['pin', `${c.mode === 'EITHER' ? 'Online or Physical' : c.mode === 'ONLINE' ? 'Online' : 'Physical'}${c.location ? ` • ${c.location}` : ''}`],
    ['tag', budgetText(c)],
  ].filter(Boolean)

  return (
    <div className="mt-2 rounded-xl border border-accent bg-accent-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-bold text-navy">
          <Icon name="sparkle" fill className="h-4 w-4 text-accent" /> Your Matching Preferences
        </div>
        <button onClick={onEdit} className="flex items-center gap-1 text-xs font-semibold text-brand-500 hover:underline">
          <Icon name="edit" className="h-3.5 w-3.5" /> Edit
        </button>
      </div>
      <ul className="space-y-1.5 text-sm text-slate-600">
        {rows.map(([icon, label]) => (
          <li key={icon} className="flex items-center gap-2">
            <Icon name={icon} className="h-4 w-4 shrink-0 text-brand-500" />
            {label}
          </li>
        ))}
      </ul>
      <button onClick={onFind} disabled={busy} className="btn-primary mt-3 w-full py-2.5">
        {busy ? 'Finding tutors…' : 'Find My Matches'} {!busy && <Icon name="arrow-right" className="h-4 w-4" />}
      </button>
    </div>
  )
}
