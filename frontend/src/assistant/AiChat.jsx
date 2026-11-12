// AI Assistant mode (read-only, Phase 1). The parent types a question; our backend lets a language model call
// read-only tools on the parent's own records and returns a short answer plus server-built cards.
//
// Safety in the browser:
//   - a privacy notice is shown before the first AI message (with the guided search as the alternative);
//   - answers are plain text; [[ref]] tokens are shown with names only when the server resolved them;
//   - supporting cards come from the server; local conversational guidance is not labelled as a records lookup;
//   - every request has an identity: only the CURRENT request may show a reply, an error or change the busy state. A
//     cancelled, cleared or replaced request is ignored completely, including its finally block;
//   - logging out or switching account clears the chat, and any reply that arrives late for an old chat is dropped.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/ui/Icon'
import Robot from '../components/ui/Robot'
import { errorMessage } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useMatching } from './MatchingContext'
import AiCard from './AiCards'
import { deleteConversation, sendAssistantMessage, splitEntities } from './aiApi'

// These exact approved questions have a server-side record lookup that does not
// depend on the external language-model service being available.
const EXAMPLES = ['When is my next lesson?', 'What homework was given in the latest lesson?', 'How much have I paid this month?', 'Find a Maths tutor for Primary 4']
const NOTICE_KEY = 'wt-ai-notice-v1'
let seq = 1

function noticeSeen(userId) {
  try { return localStorage.getItem(`${NOTICE_KEY}:${userId}`) === '1' } catch { return false }
}
function rememberNotice(userId) {
  try { localStorage.setItem(`${NOTICE_KEY}:${userId}`, '1') } catch { /* shown again next time */ }
}

const questionList = (value) => [...new Set((Array.isArray(value) ? value : []).filter((question) => typeof question === 'string' && question.trim() && question.length <= 200).map((question) => question.trim()))].slice(0, 4)

// Backend criteria -> the shape the wizard/results page keep in MatchingContext
const toUiCriteria = (c) => ({
  childId: c.childId ?? null, subject: c.subject, level: c.level, grade: c.grade ?? null, days: c.days || [], timePreset: null,
  timeStart: c.timeStart ?? null, timeEnd: c.timeEnd ?? null, mode: c.mode || 'EITHER', location: c.location || '', budgetMin: c.budgetMin ?? null,
  budgetMax: c.budgetMax ?? null, gender: c.gender || 'ANY', language: c.language || '', characteristics: c.characteristics || [], notes: '',
})

export default function AiChat({ capabilities, onUseGuided, visible = true }) {
  const { user } = useAuth()
  const userId = user?.id
  const navigate = useNavigate()
  const { setResult, setCriteria, setChatOpen } = useMatching()
  const [messages, setMessages] = useState([])
  const [conversationId, setConversationId] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [accepted, setAccepted] = useState(() => noticeSeen(userId))
  const [lastFailed, setLastFailed] = useState(null) // { message, selection } to retry
  const request = useRef(null) // { id, ac } of the ONE request whose result may still be shown (null = nothing in flight)
  const requestSeq = useRef(0)
  const scroller = useRef(null)
  const input = useRef(null)

  // The panel renders this component with key={user id}, so logging out or switching account mounts a fresh, empty
  // chat. On unmount any request still running is cancelled and its reply is ignored.
  useEffect(() => () => {
    const r = request.current
    request.current = null
    clearTimeout(r?.waitingTimer)
    r?.ac.abort()
  }, [])

  useEffect(() => {
    if (visible) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy, visible])

  const enabled = Boolean(capabilities?.enabled)

  async function send(message, selection, shownText) {
    const value = (message || '').trim()
    if (!value || request.current) return // one question at a time (read from the ref, never from stale state)
    setLastFailed(null)
    const req = { id: ++requestSeq.current, ac: new AbortController() }
    request.current = req
    const isCurrent = () => request.current === req // false once cancelled, cleared, replaced or unmounted
    setWaiting(false)
    req.waitingTimer = setTimeout(() => { if (isCurrent()) setWaiting(true) }, 8000)
    setMessages((m) => [...m, { id: seq++, from: 'user', text: shownText || value }])
    setBusy(true)
    try {
      const reply = await sendAssistantMessage({ conversationId, message: value, selection }, req.ac.signal, capabilities?.limits?.requestTimeoutMs)
      if (!isCurrent()) return
      setConversationId(reply.conversationId)
      setMessages((m) => [...m, { id: seq++, from: 'ai', ...reply }])
    } catch (err) {
      if (!isCurrent() || req.ac.signal.aborted) return
      const status = err?.response?.status
      const busyConflict = err?.response?.data?.status === 'busy' // the server is still answering something else: keep this chat
      // An expired or unknown chat: start a fresh one next time
      if ((status === 404 || status === 409) && !busyConflict) setConversationId(null)
      const quickQuestions = status === 429 || status >= 500 || !err?.response
      setLastFailed({ message: value, selection, quickQuestions })
      setMessages((m) => [...m, { id: seq++, from: 'system', text: errorMessage(err), unavailable: status === 503 || status === 429 }])
    } finally {
      clearTimeout(req.waitingTimer)
      if (isCurrent()) {
        request.current = null
        setBusy(false)
        setWaiting(false)
      }
    }
  }

  function cancel() {
    const req = request.current
    if (!req) return
    request.current = null // invalidate first: from now on nothing from this request may touch the screen
    clearTimeout(req.waitingTimer)
    req.ac.abort()
    setBusy(false)
    setWaiting(false)
    setMessages((m) => [...m, { id: seq++, from: 'system', text: 'Stopped. Nothing was saved from that question.' }])
  }

  async function clearChat() {
    const id = conversationId
    const req = request.current
    request.current = null
    clearTimeout(req?.waitingTimer)
    req?.ac.abort()
    setMessages([])
    setText('')
    setConversationId(null)
    setLastFailed(null)
    setBusy(false)
    setWaiting(false)
    if (id) deleteConversation(id).catch(() => { /* it expires on its own */ })
  }

  function onSubmit(e) {
    e.preventDefault()
    const v = text
    setText('')
    send(v)
  }

  function openResults(reply) {
    if (!reply.matchResult) return
    // Temporary: these results were not saved as a search (Phase 1 is read-only); a refresh shows the last saved search
    setResult({ ...reply.matchResult, temporary: true })
    setCriteria((c) => ({ ...c, ...toUiCriteria(reply.matchResult.criteria) }))
    setChatOpen(false)
    navigate('/parent/find-tutor/results')
  }

  const lastReply = messages.slice().reverse().find((message) => message.from === 'ai')
  const hasSuggestions = Array.isArray(lastReply?.suggestions)
  const approvedQuestions = questionList(capabilities?.suggestions)
  const quickQuestions = approvedQuestions.length ? approvedQuestions : EXAMPLES
  const followUps = hasSuggestions ? questionList(lastReply.suggestions) : lastReply?.status === 'clarification' ? [] : quickQuestions
  const showQuickQuestions = Boolean(lastFailed?.quickQuestions)
  const offeredQuestions = showQuickQuestions ? quickQuestions : followUps

  if (!capabilities) {
    return <div className="flex flex-1 items-center justify-center text-sm text-slate-500" role="status">Loading…</div>
  }

  if (!enabled) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-brand-25 p-6 text-center text-sm text-slate-600">
        <Robot className="h-14 w-14" sparkles={false} />
        <p>The AI assistant is not available right now.</p>
        <button type="button" onClick={onUseGuided} className="btn-primary px-4 py-2">Use Guided Tutor Search</button>
      </div>
    )
  }

  if (!accepted) {
    return (
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto bg-brand-25 p-4 text-sm text-slate-700">
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
          <div className="mb-1 flex items-center gap-2 font-bold text-navy"><Icon name="shield" className="h-4 w-4 text-brand-500" /> Before you start</div>
          <p>The AI assistant answers questions about your own WonderTutor records. To do this, your question and short, relevant parts of your records (for example lesson dates, amounts or what a tutor recorded) are sent to an external AI service (Google Gemini).</p>
          <p className="mt-2">We replace names with references and hide emails, phone numbers and street addresses first, but this does not make the information anonymous. The assistant is read-only: it cannot book, cancel, pay or change anything.</p>
          <p className="mt-2">Prefer not to? Guided Tutor Search works without AI. See our <a href="/privacy" className="font-semibold text-brand-600 hover:underline">Privacy Notice</a>.</p>
        </div>
        <button type="button" onClick={() => { rememberNotice(userId); setAccepted(true); setTimeout(() => input.current?.focus(), 0) }} className="btn-primary py-2.5">I understand, continue</button>
        <button type="button" onClick={onUseGuided} className="btn-outline py-2.5">Use Guided Tutor Search instead</button>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-slate-100 bg-white px-4 py-1.5 text-xs text-slate-500">
        <span>Read-only · your records and tutor search</span>
        <button type="button" onClick={clearChat} disabled={!messages.length && !busy} className="flex min-h-9 items-center gap-1 rounded-lg px-2 font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-40" aria-label="Clear chat">
          <Icon name="trash" className="h-3.5 w-3.5" /> Clear chat
        </button>
      </div>
      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto overflow-x-hidden bg-brand-25 px-4 py-4">
        {!messages.length && (
          <div className="text-sm text-slate-600">
            <p className="mb-2">Hi! How can I help? Ask about your lessons, homework, payments or finding a tutor, or try a question below.</p>
            <div className="flex flex-wrap gap-2">
              {quickQuestions.map((ex) => <button key={ex} type="button" onClick={() => send(ex)} className="chip px-3 py-1.5 text-left text-[13px]">{ex}</button>)}
            </div>
          </div>
        )}
        {messages.map((m) => <ChatMessage key={m.id} m={m} busy={busy} onChooseChild={(c) => send(`For ${c.name}`, { kind: 'child', ref: c.ref }, c.label)} onOpenResults={() => openResults(m)} />)}
        {!busy && (showQuickQuestions || (lastReply && !lastFailed)) && offeredQuestions.length > 0 && (
          <div className="space-y-2" aria-label={showQuickQuestions ? 'Quick questions' : 'Suggested questions'}>
            <p className="text-xs font-semibold text-slate-500">{showQuickQuestions ? 'Try a quick question' : 'You can also ask'}</p>
            <div className="flex flex-wrap gap-2">
              {offeredQuestions.map((question) => <button key={question} type="button" onClick={() => send(question)} className="chip max-w-full break-words px-3 py-1.5 text-left text-[13px]">{question}</button>)}
            </div>
          </div>
        )}
        <div aria-live="polite" role="status" className="text-sm text-slate-500">
          {busy && (
            <div className="space-y-1">
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" /> Looking that up…
                <button type="button" onClick={cancel} className="min-h-9 rounded-lg px-2 font-semibold text-brand-600 hover:bg-brand-50">Cancel</button>
              </span>
              {waiting && <p className="text-xs">Still working on your question. You can cancel at any time.</p>}
            </div>
          )}
          {!busy && lastFailed && (
            <button type="button" onClick={() => send(lastFailed.message, lastFailed.selection)} className="min-h-9 rounded-lg px-2 font-semibold text-brand-600 hover:bg-brand-50">Retry</button>
          )}
        </div>
      </div>
      <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-slate-100 bg-white p-3">
        <input
          ref={input}
          aria-label="Question for the AI assistant"
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask about lessons, payments, tutors…"
          className="input h-11 min-w-0 flex-1"
          disabled={busy}
        />
        <button disabled={busy || !text.trim()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white shadow hover:bg-brand-600 disabled:opacity-50" aria-label="Send">
          <Icon name="send" className="h-[18px] w-[18px]" />
        </button>
      </form>
    </>
  )
}

function ChatMessage({ m, busy, onChooseChild, onOpenResults }) {
  if (m.from === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] break-words rounded-xl bg-brand-100 px-3.5 py-2 text-sm text-navy">{m.text}</div>
      </div>
    )
  }
  if (m.from === 'system') {
    return <div role="alert" className="rounded-xl bg-white px-3.5 py-2.5 text-sm text-slate-700 ring-1 ring-amber-200">{m.text}{m.unavailable && <div className="mt-1 text-xs text-slate-500">You can switch to Guided Tutor Search above.</div>}</div>
  }
  const hasEvidence = Boolean(m.sources?.length || m.cards?.length)
  const caption = m.responseKind === 'lookup'
    ? 'WonderTutor records'
    : m.responseKind === 'clarification'
      ? 'Clarifying question'
    : m.responseKind === 'conversation' || m.responseKind === 'fallback' || !hasEvidence
      ? 'WonderTutor assistant'
      : 'AI-assisted answer · supporting details below'
  return (
    <div className="flex items-start gap-2">
      <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-brand-100"><Robot className="h-6 w-6" sparkles={false} /></span>
      <div className="min-w-0 flex-1">
        <div className="whitespace-pre-line break-words rounded-xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm text-slate-700 shadow-sm ring-1 ring-brand-100">
          {splitEntities(m.text, m.entities).map((p, i) => (p.entity ? <strong key={i} className="font-semibold text-navy">{p.entity}</strong> : <span key={i}>{p.text}</span>))}
        </div>
        <div className="mt-0.5 text-[11px] text-slate-400">{caption}</div>
        {m.cards?.map((c, i) => <AiCard key={i} card={c} busy={busy} onChooseChild={onChooseChild} onOpenResults={onOpenResults} />)}
        {m.sources?.length > 0 && (
          <details className="mt-1 text-xs text-slate-500">
            <summary className="cursor-pointer">Sources ({m.sources.length})</summary>
            <ul className="mt-1 list-disc pl-4">{m.sources.map((s) => <li key={s.id}>{s.label}</li>)}</ul>
          </details>
        )}
      </div>
    </div>
  )
}
