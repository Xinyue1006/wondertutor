// One assistant turn:
//   authenticate (route middleware) -> validate message + conversation -> redact input -> model with tool declarations
//   -> validate and run only allowlisted read tools -> minimised results back to the model (bounded loop)
//   -> the visible answer is written by the SERVER from validated tool evidence (answers.js); model prose is used only when
//   there is no account evidence and it passes a conservative screen -> server-built cards + sources -> reply.
// State discipline: every turn works on a staged copy of the conversation and commits it only on success. One turn at a
// time per conversation. A cancelled, timed-out or failed turn leaves the conversation exactly as it was.
// Bounded everywhere: total deadline, tool rounds, tool calls, repeated identical calls, output tokens, result size.
import { randomBytes } from 'node:crypto'
import { env } from '../../config/env.js'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { mytParts } from '../../utils/time.js'
import { messageRequestSchema, cardSchema, sourceSchema } from './schemas.js'
import { TurnBusyError, beginTurn, commitStaged, createSession, endTurn, getSession, refFor, resolveRef, stageSession, touch, turnLimitReached } from './session.js'
import { expandNames, namePairs, redactText, sanitizeContents } from './privacy.js'
import { clarifyText, composeFromEvidence, detectLanguage, noEvidenceText, screenModelProse } from './answers.js'
import { executeTool, toolDeclarations } from './tools.js'
import { getProvider, ProviderError } from './provider.js'
import { PROMPT_VERSION, systemInstruction } from './prompt.js'
import { FAQ_VERSION } from './faq.js'

const MAX_TOOL_RESULT_CHARS = 6000
const opaque = () => randomBytes(12).toString('base64url')

function boundResult(result) {
  const json = JSON.stringify(result)
  if (json.length <= MAX_TOOL_RESULT_CHARS) return result
  return { truncated: true, note: 'Result was too long and has been shortened.', preview: json.slice(0, MAX_TOOL_RESULT_CHARS) }
}

function validCards(cards) {
  const out = []
  for (const c of cards) {
    const r = cardSchema.safeParse(c)
    if (r.success) out.push(r.data)
    else if (env.nodeEnv !== 'test') console.warn('[assistant] dropped invalid card', c.type)
  }
  return out.slice(0, 6)
}

async function callModel(provider, req, deadline, signal) {
  // At most one retry for a transient failure, and only while there is time left
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new ProviderError('cancelled', 'Cancelled') // never start a provider call for a dead turn
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new ProviderError('timeout', 'Took too long')
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort('timeout'), remaining)
    const onAbort = () => ac.abort('cancelled')
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      return await provider.generate({ ...req, signal: ac.signal })
    } catch (err) {
      if (signal?.aborted) throw new ProviderError('cancelled', 'Cancelled')
      if (ac.signal.aborted && ac.signal.reason === 'timeout') throw new ProviderError('timeout', 'Took too long')
      const pe = err instanceof ProviderError ? err : new ProviderError('bad_response', 'Unexpected AI error')
      if (pe.transient && attempt === 0 && deadline - Date.now() > 1000) continue
      throw pe
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

const USER_MESSAGES = {
  timeout: 'The AI assistant took too long to answer. Please try again, or use Guided Tutor Search.',
  rate_limit: 'The AI assistant is busy right now. Please try again in a minute, or use Guided Tutor Search.',
  unavailable: 'The AI assistant is not available right now. Guided Tutor Search still works.',
  bad_response: 'The AI assistant could not answer that. Please try again, or use Guided Tutor Search.',
  disabled: 'The AI assistant is switched off. You can still use Guided Tutor Search.',
  tool_loop: 'The AI assistant could not finish that request. Please ask in a simpler way.',
  busy: 'The previous question in this chat is still being answered. Please wait a moment and try again.',
  gone: 'Conversation not found. Please start a new chat.',
}

// Tool errors that mean "that record is not there" (shown to the parent by a server template). Model mistakes such as
// unknown tools or invalid arguments are not shown as missing data.
const MISSING = { not_found: 'not_found', not_in_results: 'not_found', no_children: 'no_children', invalid_range: 'invalid_range' }

const cancelled = (reason) => Object.assign(new AppError(reason === 'deleted' ? 404 : 499, reason === 'deleted' ? USER_MESSAGES.gone : 'Cancelled'), { assistantStatus: 'cancelled' })
const stopIfCancelled = (turn) => { if (turn.signal.aborted) throw new ProviderError('cancelled', 'Cancelled') }

export async function handleMessage({ user, parent, body, signal, now = new Date(), db = prisma }) {
  const data = messageRequestSchema.parse(body)
  let session
  if (data.conversationId) {
    session = getSession(data.conversationId, user, parent)
    if (!session) throw new AppError(404, USER_MESSAGES.gone)
  } else {
    session = createSession(user, parent)
  }
  if (turnLimitReached(session)) throw new AppError(409, 'This chat has reached its length limit. Please start a new chat.')
  // One turn at a time per conversation. Taken synchronously, before any await, so two requests cannot both pass.
  let turn
  try {
    turn = beginTurn(session, signal)
  } catch (err) {
    if (err instanceof TurnBusyError) throw Object.assign(new AppError(409, USER_MESSAGES.busy), { assistantStatus: 'busy', conversationId: session.id })
    throw err
  }
  try {
    return await runTurn({ user, parent, data, session, turn, now, db })
  } finally {
    endTurn(session, turn)
  }
}

async function runTurn({ user, parent, data, session, turn, now, db }) {
  const started = Date.now()
  const requestId = opaque()
  const log = { requestId, tools: [], outcome: 'ok', usage: { inputTokens: 0, outputTokens: 0 }, prompt: PROMPT_VERSION, faq: FAQ_VERSION }
  const finish = (outcome) => {
    log.outcome = outcome
    log.latencyMs = Date.now() - started
    if (env.nodeEnv !== 'test') console.info('[assistant]', JSON.stringify(log)) // ids, names of tools, counts only
  }
  touch(session)
  const work = stageSession(session) // nothing below changes the real conversation until commitStaged()
  turn.work = work // read by the evaluation harness only (to resolve placeholders to this turn's references)
  const namesNow = () => expandNames(namePairs(work, user.fullName))

  try {
    stopIfCancelled(turn)
    // Known names in the conversation become references before anything is sent to the provider
    const kids = await db.child.findMany({ where: { parentId: parent.id }, select: { id: true, name: true } })
    for (const k of kids) refFor(work, 'child', k.id, k.name)
    // Tutors this family has booked are also known names (a parent often types them)
    const booked = await db.booking.findMany({ where: { parentId: parent.id }, distinct: ['tutorId'], take: 50, select: { tutorId: true, tutor: { select: { user: { select: { fullName: true } } } } } })
    for (const b of booked) refFor(work, 'tutor', b.tutorId, b.tutor.user.fullName)
    stopIfCancelled(turn)

    let selectedChildRef = null
    if (data.selection) {
      const id = resolveRef(work, 'child', data.selection.ref)
      if (!id || !kids.some((k) => k.id === id)) throw new AppError(404, USER_MESSAGES.gone)
      selectedChildRef = data.selection.ref
    }
    let userText = redactText(data.message, { names: namesNow(), max: 2000 })
    if (selectedChildRef) userText += `\n(The parent selected [[${selectedChildRef}]].)`

    const ctx = { session: work, user, parent, db, now, cards: [], sources: [], evidence: [], needs: null, clarification: null, matchResult: null, selectedChildRef }
    const provider = getProvider()
    const cfg = env.ai
    if (!cfg.enabled && provider.name === 'gemini') {
      finish('disabled')
      throw Object.assign(new AppError(503, USER_MESSAGES.disabled), { assistantStatus: 'unavailable' })
    }

    const today = mytParts(now)
    const system = systemInstruction({ todayMyt: today.date, nowMytTime: today.time })
    const contents = [...session.history, { role: 'user', parts: [{ text: userText }] }]
    const deadline = started + cfg.timeoutMs
    const seenCalls = new Set()
    let calls = 0
    let text = null

    for (let round = 0; round <= cfg.maxToolRounds; round++) {
      // The one boundary to the provider: history, the new message and tool results are all filtered here, every round
      const res = await callModel(provider, { system, contents: sanitizeContents(contents, namesNow()), tools: toolDeclarations(), maxOutputTokens: cfg.maxOutputTokens }, deadline, turn.signal)
      log.usage.inputTokens += res.usage?.inputTokens || 0
      log.usage.outputTokens += res.usage?.outputTokens || 0
      stopIfCancelled(turn)
      const parts = Array.isArray(res.parts) ? res.parts : []
      const fcs = parts.filter((p) => p && p.functionCall && typeof p.functionCall.name === 'string')
      if (!fcs.length) {
        text = parts.filter((p) => typeof p?.text === 'string' && !p.thought).map((p) => p.text).join('').trim() || null
        break
      }
      if (round === cfg.maxToolRounds) { log.outcome = 'tool_loop'; break }
      contents.push({ role: 'model', parts }) // unchanged, so any thoughtSignature is returned as required
      const responses = []
      for (const p of fcs) {
        stopIfCancelled(turn) // between tool calls
        const { name, args } = p.functionCall
        const key = `${name}:${JSON.stringify(args ?? {})}`
        let result
        if (++calls > cfg.maxToolCalls) result = { error: 'too_many_calls', message: 'Tool call limit reached. Answer with what you have.' }
        else if (seenCalls.has(key)) result = { error: 'duplicate_call', message: 'This exact call was already made; use its earlier result.' }
        else {
          seenCalls.add(key)
          const out = await executeTool(ctx, name, args)
          stopIfCancelled(turn)
          log.tools.push(out.ok ? name : `${String(name).slice(0, 40)}:rejected`)
          result = out.result
          if (out.ok && result?.error && MISSING[result.error]) ctx.evidence.push({ kind: 'missing', tool: name, reason: MISSING[result.error] })
          if (out.ok && (result?.needsClarification === 'subject' || result?.needsClarification === 'level')) ctx.needs = result.needsClarification
        }
        responses.push({ functionResponse: { name, response: boundResult(result) } })
      }
      contents.push({ role: 'user', parts: responses })
    }
    stopIfCancelled(turn)

    // ── the visible answer ──
    const lang = detectLanguage(data.message)
    let finalText
    let cards = validCards(ctx.clarification ? [ctx.clarification, ...ctx.cards] : ctx.cards)
    let sources = ctx.sources.filter((s) => sourceSchema.safeParse(s).success).slice(0, 10)
    let matchResult = ctx.matchResult
    const prose = screenModelProse(text, work)
    if (log.outcome === 'tool_loop') {
      // The turn did not finish: show only the apology, keep none of its results, and do not store it
      finalText = USER_MESSAGES.tool_loop
      cards = []; sources = []; matchResult = null
      finish('tool_loop')
      return { conversationId: session.id, messageId: opaque(), status: 'answer', text: finalText, entities: {}, cards, sources, criteria: null, matchResult: null, asOf: now.toISOString() }
    }
    if (ctx.evidence.length) {
      // Account facts: written by the server from this turn's evidence. The model's own wording is not shown.
      finalText = composeFromEvidence(ctx, lang)
      log.answer = 'server_evidence'
      if (text) log.modelProse = prose.ok ? 'unused' : prose.reason
    } else if (ctx.clarification || ctx.needs) {
      // A clarification must actually ask. Natural model wording is kept only if it is a fact-free question.
      const askedByModel = prose.ok && /[?？]/.test(text)
      finalText = askedByModel ? text : ctx.clarification ? ctx.clarification.title : clarifyText(ctx.needs, lang)
      log.answer = askedByModel ? 'model_prose' : 'server_clarification'
    } else {
      finalText = prose.ok ? text : noEvidenceText(lang)
      log.answer = prose.ok ? 'model_prose' : 'server_no_evidence'
      if (!prose.ok) log.modelProse = prose.reason
    }

    // Only references that exist in this conversation are given display names (rendered by the app, not the model)
    const entities = {}
    for (const m of finalText.matchAll(/\[\[([a-z]+_\d+)\]\]/g)) {
      const label = work.labels.get(m[1])
      if (label) entities[m[1]] = label
    }

    // Commit: all-or-nothing, and only if this turn is still the live one for a conversation that still exists
    if (!commitStaged(session, turn, work, userText, finalText)) {
      finish('cancelled')
      throw cancelled(turn.signal.aborted ? turn.signal.reason : 'deleted')
    }
    finish('ok')
    return {
      conversationId: session.id,
      messageId: opaque(),
      status: ctx.clarification ? 'clarification' : 'answer',
      text: finalText,
      entities,
      cards,
      sources,
      criteria: matchResult ? matchResult.criteria : null,
      matchResult,
      asOf: now.toISOString(),
    }
  } catch (err) {
    if (err instanceof ProviderError) {
      finish(err.kind)
      if (err.kind === 'cancelled') throw cancelled(turn.signal.reason)
      throw Object.assign(new AppError(err.kind === 'rate_limit' ? 429 : 503, USER_MESSAGES[err.kind] || USER_MESSAGES.unavailable), { assistantStatus: 'unavailable', conversationId: session.id })
    }
    throw err // staged state is simply dropped
  }
}
