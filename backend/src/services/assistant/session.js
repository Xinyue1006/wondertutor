// Temporary, server-held assistant conversations (Phase 1: memory only, no database table).
//
// Why memory: the project runs as ONE Node process, so a Map is enough and nothing about a chat is stored long-term.
// Limits that follow from this (documented in docs/AI_ASSISTANT.md):
//   - a server restart forgets every conversation (the parent just starts a new one);
//   - with several server instances a conversation would only exist on the instance that created it.
//
// Every conversation is bound to the authenticated user id AND parent profile id. Looking one up with any other
// identity behaves exactly like "does not exist", so a guessed or leaked id reveals nothing.
//
// Entity references ("refs"): the model never sees database ids. Each record the assistant shows gets an opaque ref
// such as "child_1" or "booking_3" that only means something inside this conversation. The server maps refs back to
// ids, so the model cannot ask for a record the parent does not own by inventing an id.
import { randomBytes } from 'node:crypto'
import { env } from '../../config/env.js'

const store = new Map() // id -> session
const KINDS = ['child', 'booking', 'tutor', 'payment', 'complaint', 'search']

const newId = () => randomBytes(18).toString('base64url')
const cfg = () => env.ai

function sweep(now = Date.now()) {
  for (const [id, s] of store) if (s.expiresAt <= now) store.delete(id)
}
const sweeper = setInterval(sweep, 60_000)
sweeper.unref?.()

function emptySession(user, parent, now) {
  return {
    id: newId(),
    userId: user.id,
    parentId: parent.id,
    createdAt: now,
    expiresAt: now + cfg().conversationTtlMs,
    turns: 0,
    history: [], // provider-format contents of COMPLETED turns (text only; kept within maxTurns)
    refs: new Map(), // ref -> { kind, id }
    byKey: new Map(), // `${kind}:${id}` -> ref
    counters: Object.fromEntries(KINDS.map((k) => [k, 0])),
    labels: new Map(), // ref -> display name (server-side only; used to render [[ref]] tokens and to redact names)
    searches: new Map(), // searchRef -> { criteria, at }
    lastCriteria: null, // the criteria of the latest assistant search (carried through refinements)
    selectedChildRef: null,
    active: null, // the turn currently being answered (one at a time)
    deleted: false,
  }
}

// Returns a new conversation, enforcing per-user and global caps by evicting the oldest ones.
export function createSession(user, parent, now = Date.now()) {
  sweep(now)
  const mine = [...store.values()].filter((s) => s.userId === user.id).sort((a, b) => a.createdAt - b.createdAt)
  while (mine.length >= cfg().maxConversationsPerUser) store.delete(mine.shift().id)
  if (store.size >= cfg().maxConversations) {
    const oldest = [...store.values()].sort((a, b) => a.createdAt - b.createdAt)[0]
    if (oldest) store.delete(oldest.id)
  }
  const s = emptySession(user, parent, now)
  store.set(s.id, s)
  return s
}

// The conversation if it exists, has not expired and belongs to this user + parent; otherwise null.
export function getSession(id, user, parent, now = Date.now()) {
  if (typeof id !== 'string') return null
  const s = store.get(id)
  if (!s) return null
  if (s.expiresAt <= now) {
    store.delete(id)
    return null
  }
  if (s.userId !== user.id || s.parentId !== parent.id) return null
  return s
}

export function touch(s, now = Date.now()) {
  s.expiresAt = now + cfg().conversationTtlMs
}

export function deleteSession(id, user, parent) {
  const s = getSession(id, user, parent)
  if (!s) return false
  s.deleted = true // a turn still running for this chat can never commit into it (see commitStaged)
  store.delete(id)
  s.active?.ac.abort('deleted') // and it stops calling the provider / tools as soon as it notices
  return true
}

// Account deletion must also discard temporary personal data and cancel in-flight turns.
export function deleteUserSessions(userId) {
  for (const s of store.values()) {
    if (s.userId !== userId) continue
    s.deleted = true
    store.delete(s.id)
    s.active?.ac.abort('deleted')
  }
}

// ───────────── one turn at a time, staged state ─────────────
// Policy for overlapping requests on ONE conversation: the second one is rejected as a retryable conflict ("busy"),
// except when the first was already cancelled by the browser: then the new turn takes over at once and the old turn can
// no longer commit anything (its token no longer matches). This keeps a quick "Cancel, then ask again" working without
// two turns ever writing into the same conversation.
export class TurnBusyError extends Error {}

export function beginTurn(s, externalSignal) {
  if (s.active && !s.active.ac.signal.aborted) throw new TurnBusyError('A previous question in this chat is still being answered.')
  const ac = new AbortController()
  const turn = { ac, signal: ac.signal, done: false }
  if (externalSignal) {
    if (externalSignal.aborted) ac.abort('cancelled')
    else externalSignal.addEventListener('abort', () => ac.abort('cancelled'), { once: true })
  }
  s.active = turn
  return turn
}

export function endTurn(s, turn) {
  turn.done = true
  if (s.active === turn) s.active = null
}

// The conversation state a turn works on. Tools, reference creation, searches and refinement criteria change THIS copy.
// Nothing reaches the real conversation until commitStaged(), so a cancelled, timed-out or failed turn leaves no trace.
export function stageSession(s) {
  return {
    ...s,
    refs: new Map(s.refs),
    byKey: new Map(s.byKey),
    counters: { ...s.counters },
    labels: new Map(s.labels),
    searches: new Map(s.searches),
  }
}

// Atomic (no await): copies the staged state and the finished turn into the real conversation, but only if this turn is
// still the active one and the conversation was not deleted, evicted or expired meanwhile.
export function commitStaged(s, turn, work, userText, answerText, now = Date.now()) {
  if (turn.signal.aborted || s.active !== turn || s.deleted || store.get(s.id) !== s || s.expiresAt <= now) return false
  s.refs = work.refs
  s.byKey = work.byKey
  s.counters = work.counters
  s.labels = work.labels
  s.searches = work.searches
  s.lastCriteria = work.lastCriteria
  remember(s, userText, answerText)
  return true
}

// Ref for a record, creating one the first time it is shown in this conversation
export function refFor(s, kind, id, label) {
  const key = `${kind}:${id}`
  let ref = s.byKey.get(key)
  if (!ref) {
    s.counters[kind] += 1
    ref = `${kind}_${s.counters[kind]}`
    s.byKey.set(key, ref)
    s.refs.set(ref, { kind, id })
  }
  if (label) s.labels.set(ref, label)
  return ref
}

// The database id behind a ref, only if the ref exists in THIS conversation and is of the expected kind
export function resolveRef(s, kind, ref) {
  if (typeof ref !== 'string') return null
  const hit = s.refs.get(ref)
  return hit && hit.kind === kind ? hit.id : null
}

export function remember(s, userText, modelText) {
  s.history.push({ role: 'user', parts: [{ text: userText }] }, { role: 'model', parts: [{ text: modelText }] })
  s.turns += 1
  // Keep only the most recent turns (each turn = 2 entries)
  const max = cfg().maxTurns * 2
  if (s.history.length > max) s.history.splice(0, s.history.length - max)
}

export const turnLimitReached = (s) => s.turns >= cfg().maxTurns

// Tests only
export const _store = store
export const _clearAll = () => store.clear()
