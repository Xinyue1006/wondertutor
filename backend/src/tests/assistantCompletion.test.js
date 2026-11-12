// Completion-plan regressions use real orchestration/tools with a fake database
// and provider. They never reset a database or call an external model.
import { jest } from '@jest/globals'
import { env } from '../config/env.js'
import { handleMessage } from '../services/assistant/orchestrator.js'
import { ProviderError, setProvider } from '../services/assistant/provider.js'
import { _clearAll, _store, getSession } from '../services/assistant/session.js'
import { messageRequestSchema, toolArgs } from '../services/assistant/schemas.js'
import { gradeCase, observeCase } from '../eval/assistantEval.js'

const user = { id: 861, fullName: 'Synthetic Parent' }, parent = { id: 862 }
const now = new Date('2026-11-13T04:00:00Z')
const booking = {
  id: 25, publicId: '822299af-7798-4e30-984d-3dbe931bfb2f', parentId: parent.id, childId: 8, tutorId: 9,
  subject: 'Mathematics', startAt: new Date('2026-11-16T09:00:00Z'), endAt: new Date('2026-11-16T10:00:00Z'),
  status: 'CONFIRMED', teachingMode: 'ONLINE', proposedPrice: 55, agreedPrice: 55,
  child: { name: 'Synthetic Child' }, tutor: { user: { fullName: 'Synthetic Tutor' } },
  summary: { content: 'Fractions.', topics: 'Fractions', homework: 'Page 12 exercises', recommendations: null, progressNote: null },
  attendance: null,
}
function fakeDb() {
  const count = () => jest.fn(async () => 0)
  return {
    child: { count: count(), findMany: jest.fn(async () => []) },
    booking: {
      count: count(),
      findMany: jest.fn(async query => query.distinct ? [] : [booking]),
      findFirst: jest.fn(async query => query.where.id === booking.id && query.where.parentId === parent.id ? booking : null),
    },
    matchingRequest: { count: count() }, notification: { count: count() }, complaint: { count: count() },
    payment: { count: count() }, refund: { count: count() }, review: { count: count() }, favouriteTutor: { count: count() },
  }
}
const call = (name, args = {}, id = name) => ({ functionCall: { name, args, id } })
const ask = (options = {}) => handleMessage({ user, parent, now, body: { message: 'Please show the next confirmed lesson in my account.' }, allowQuickQuestions: false, db: fakeDb(), ...options })
const model = (generate) => { const fn = jest.fn(generate); setProvider({ name: 'mock', generate: fn }); return fn }

beforeEach(_clearAll)
afterEach(() => setProvider(null))

test('a valid completed read plan returns grounded records without a redundant generation', async () => {
  const generate = model(async () => ({ parts: [call('list_bookings', { limit: 1 }), call('finish_lookup')] }))
  const results = []
  const response = await ask({ onToolResult: r => results.push(r) })
  expect(generate).toHaveBeenCalledTimes(1)
  expect(response).toMatchObject({ status: 'answer', responseKind: 'records' })
  expect(response.text).toContain('2026-11-16')
  expect(response.text).toContain('17:00')
  expect(response.cards[0].bookings[0].link).toContain(booking.publicId)
  expect(results.map(r => r.name)).toEqual(['list_bookings', 'finish_lookup'])
  expect(results[0].response.bookings[0].bookingRef).toBe('booking_1')
  expect(getSession(response.conversationId, user, parent).turns).toBe(1)
})

test('every independent read in a compound plan runs before completion', async () => {
  const db = fakeDb(), results = []
  const generate = model(async () => ({ parts: [call('list_children'), call('search_faq', { question: 'refund' }), call('finish_lookup')] }))
  const response = await ask({ db, body: { message: 'Show my child profiles and explain refunds.' }, onToolResult: r => results.push(r) })
  expect(generate).toHaveBeenCalledTimes(1)
  expect(results.map(r => r.name)).toEqual(['list_children', 'search_faq', 'finish_lookup'])
  expect(response.text).toMatch(/child profiles|children/i)
  expect(response.cards.some(c => c.type === 'faq')).toBe(true)
  expect(response.sources.some(s => s.kind === 'faq')).toBe(true)
  expect(db.child.findMany).toHaveBeenCalledTimes(2) // initial references plus the requested read
})

test('preliminary booking evidence does not truncate a dependent lesson-detail query', async () => {
  const db = fakeDb(), results = []
  const generate = model(async request => {
    if (request.contents.at(-1).parts.some(p => p.functionResponse)) {
      const ref = request.contents.at(-1).parts[0].functionResponse.response.bookings[0].bookingRef
      return { parts: [call('get_lesson_details', { bookingRef: ref }), call('finish_lookup')] }
    }
    return { parts: [call('list_bookings', { when: 'past', status: 'COMPLETED', limit: 1 })] }
  })
  const response = await ask({ db, body: { message: 'What homework did the tutor assign in the most recent completed lesson?' }, onToolResult: r => results.push(r) })
  expect(generate).toHaveBeenCalledTimes(2)
  expect(results.map(r => r.name)).toEqual(['list_bookings', 'get_lesson_details', 'finish_lookup'])
  expect(response.cards.find(c => c.type === 'lesson_detail').summary.homework).toBe('Page 12 exercises')
  expect(db.booking.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: booking.id, parentId: parent.id } }))
})

test('older models without a completion marker keep their dependent tool loop', async () => {
  let round = 0
  const generate = model(async () => ({ parts: round++ === 0 ? [call('list_bookings')] : round === 2 ? [call('get_lesson_details', { bookingRef: 'booking_1' })] : [{ text: 'Here are the records.' }] }))
  const response = await ask()
  expect(generate).toHaveBeenCalledTimes(3)
  expect(response.cards.some(c => c.type === 'lesson_detail')).toBe(true)
})

test('a trusted missing-criteria question finishes without another model request', async () => {
  const generate = model(async () => ({ parts: [call('search_tutors')] }))
  const response = await ask({ body: { message: 'Please find me a tutor.' } })
  expect(generate).toHaveBeenCalledTimes(1)
  expect(response.status).toBe('clarification')
  expect(response.text).toMatch(/subject.*education level/i)
  expect(response.text).toMatch(/\?/)
  expect(response.matchResult).toBeNull()
})

test.each([
  ['control alone', [call('finish_lookup')]],
  ['catalog without factual evidence', [call('get_matching_catalog'), call('finish_lookup')]],
  ['marker before the final read', [call('list_children'), call('finish_lookup'), call('search_faq', { question: 'refund' })]],
  ['invalid marker arguments', [call('list_bookings'), call('finish_lookup', { answer: 'invented' })]],
  ['unknown action', [call('list_bookings'), call('create_booking'), call('finish_lookup')]],
  ['duplicate read', [call('list_bookings'), call('list_bookings', {}, 'duplicate'), call('finish_lookup')]],
  ['missing record', [call('get_lesson_details', { bookingRef: 'booking_999' }), call('finish_lookup')]],
])('%s cannot bypass the remaining model loop', async (_, parts) => {
  let round = 0
  const generate = model(async () => ({ parts: round++ === 0 ? parts : [{ text: 'What would you like to check?' }] }))
  await ask()
  expect(generate).toHaveBeenCalledTimes(2)
})

test('a tool-call limit cannot be treated as a successfully completed plan', async () => {
  const saved = env.ai.maxToolCalls
  env.ai.maxToolCalls = 1
  let round = 0
  const generate = model(async () => ({ parts: round++ === 0 ? [call('list_bookings'), call('finish_lookup')] : [{ text: 'Here are the records.' }] }))
  const results = []
  try {
    await ask({ onToolResult: r => results.push(r) })
    expect(generate).toHaveBeenCalledTimes(2)
    expect(results.at(-1)).toMatchObject({ name: 'finish_lookup', response: { error: 'too_many_calls' } })
  } finally { env.ai.maxToolCalls = saved }
})

test('a corrected read plan can finish after a rejected earlier batch without reusing preliminary evidence', async () => {
  let round = 0
  const generate = model(async () => ({ parts: round++ === 0
    ? [call('list_bookings', { privateField: true }), call('finish_lookup')]
    : [call('list_bookings', { limit: 1 }), call('finish_lookup')] }))
  const results = []
  const response = await ask({ onToolResult: result => results.push(result) })
  expect(generate).toHaveBeenCalledTimes(2)
  expect(results[0].response.error).toBe('invalid_arguments')
  expect(response.responseKind).toBe('records')
  expect(response.cards[0].bookings[0].link).toContain(booking.publicId)
})

test('cancelling a completed-plan read cannot commit staged references or history', async () => {
  const ac = new AbortController()
  model(async () => ({ parts: [call('list_bookings'), call('finish_lookup')] }))
  await expect(ask({ signal: ac.signal, onToolResult: r => { if (r.name === 'list_bookings') ac.abort() } })).rejects.toMatchObject({ assistantStatus: 'cancelled' })
  const session = [..._store.values()][0]
  expect(session.refs.size).toBe(0)
  expect(session.history).toEqual([])
  expect(session.turns).toBe(0)
})

test('the trusted result observer receives a snapshot and cannot be set through HTTP', async () => {
  model(async () => ({ parts: [call('list_bookings'), call('finish_lookup')] }))
  const response = await ask({ onToolResult: r => { if (r.name === 'list_bookings') r.response.bookings[0].date = '2099-01-01' } })
  expect(response.text).toContain('2026-11-16')
  expect(response.text).not.toContain('2099-01-01')
  expect(messageRequestSchema.safeParse({ message: 'show lessons', onToolResult: 'pretend tool result' }).success).toBe(false)
  expect(toolArgs.finish_lookup.safeParse({}).success).toBe(true)
  expect(toolArgs.finish_lookup.safeParse({ completed: true }).success).toBe(false)
})

test('evaluation observes actual completed reads even without a later provider payload', async () => {
  const generate = model(async () => ({ parts: [call('list_bookings'), call('finish_lookup')] }))
  const c = { id: 'completion-eval', category: 'bookings', language: 'en', turns: [{ user: 'Please show my upcoming confirmed lessons.' }], expect: { outcome: 'answer', tools: ['list_bookings'], args: { list_bookings: {} }, evidence: ['Mathematics'], forbidden: [] } }
  const observation = await observeCase(c, { parentUser: user, parent }, { mode: 'live', db: fakeDb() })
  expect(generate).toHaveBeenCalledTimes(1)
  expect(observation.turns[0].results.map(r => r.name)).toEqual(['list_bookings', 'finish_lookup'])
  expect(observation.payloadJson).not.toContain('functionResponse')
  expect(gradeCase(c, observation)).toMatchObject({ pass: true, checks: { toolsExecuted: true, noWrites: true } })
  const controlOnly = { ...c, expect: { ...c.expect, tools: ['finish_lookup'] } }
  expect(gradeCase(controlOnly, observation).checks.toolsExecuted).toBe(false)
})

test('a brief overload gets one delayed retry and can recover a real read plan', async () => {
  let attempts = 0
  const generate = model(async () => {
    if (attempts++ === 0) throw new ProviderError('unavailable', 'Synthetic overload', { transient: true, httpStatus: 503 })
    return { parts: [call('list_bookings'), call('finish_lookup')] }
  })
  const started = Date.now()
  const response = await ask()
  expect(generate).toHaveBeenCalledTimes(2)
  expect(Date.now() - started).toBeGreaterThanOrEqual(450)
  expect(response.cards[0].bookings).toHaveLength(1)
})

test('repeated overload stops after one retry, while quota errors never retry', async () => {
  const saved = env.ai.timeoutMs
  env.ai.timeoutMs = 45000
  try {
    for (const [kind, httpStatus, attempts] of [['unavailable', 503, 2], ['rate_limit', 429, 1]]) {
      const generate = model(async () => { throw new ProviderError(kind, 'Synthetic capacity error', { transient: true, httpStatus }) })
      await expect(ask()).rejects.toMatchObject({ assistantStatus: 'unavailable', status: httpStatus })
      expect(generate).toHaveBeenCalledTimes(attempts)
    }
  } finally { env.ai.timeoutMs = saved }
})

test('an overload too close to the turn deadline is not retried', async () => {
  const saved = env.ai.timeoutMs
  env.ai.timeoutMs = 1500
  const generate = model(async () => { throw new ProviderError('unavailable', 'Synthetic overload', { transient: true, httpStatus: 503 }) })
  try {
    await expect(ask()).rejects.toMatchObject({ assistantStatus: 'unavailable', status: 503 })
    expect(generate).toHaveBeenCalledTimes(1)
  } finally { env.ai.timeoutMs = saved }
})

test('cancel during overload backoff prevents the retry and leaves no committed turn', async () => {
  const ac = new AbortController()
  let firstFailure
  const attempted = new Promise(resolve => { firstFailure = resolve })
  const generate = model(async () => {
    firstFailure()
    throw new ProviderError('unavailable', 'Synthetic overload', { transient: true, httpStatus: 503 })
  })
  const turn = ask({ signal: ac.signal })
  const rejected = expect(turn).rejects.toMatchObject({ assistantStatus: 'cancelled' })
  await attempted
  // Let the rejected provider promise enter the cancellable backoff first.
  await new Promise(resolve => setTimeout(resolve, 10))
  ac.abort()
  await rejected
  expect(generate).toHaveBeenCalledTimes(1)
  const session = [..._store.values()][0]
  expect(session.history).toEqual([])
  expect(session.turns).toBe(0)
})

// Fake clocks exercise long provider stalls without waiting in real time or
// making network calls. Every stalled fake honours its attempt AbortSignal.
const stalledGeneration = ({ signal }) => new Promise((_, reject) => {
  if (signal.aborted) return reject(new Error('Synthetic aborted generation'))
  signal.addEventListener('abort', () => reject(new Error('Synthetic aborted generation')), { once: true })
})
async function withTurnClock(timeoutMs, run) {
  const saved = env.ai.timeoutMs
  env.ai.timeoutMs = timeoutMs
  jest.useFakeTimers()
  const jitter = jest.spyOn(Math, 'random').mockReturnValue(0)
  try { await run() }
  finally { jitter.mockRestore(); jest.useRealTimers(); env.ai.timeoutMs = saved }
}

test('a stalled first generation is capped at eighteen seconds and its sole retry can recover', async () => {
  await withTurnClock(45000, async () => {
    let firstSignal, attempts = 0
    const generate = model(async request => {
      if (attempts++ === 0) { firstSignal = request.signal; return stalledGeneration(request) }
      return { parts: [call('list_bookings'), call('finish_lookup')] }
    })
    const started = Date.now(), pending = ask()
    await jest.advanceTimersByTimeAsync(17999)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(firstSignal.aborted).toBe(false)
    await jest.advanceTimersByTimeAsync(1)
    expect(firstSignal.aborted).toBe(true)
    expect(firstSignal.reason).toBe('attempt_timeout')
    await jest.advanceTimersByTimeAsync(499)
    expect(generate).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(1)
    const response = await pending
    expect(generate).toHaveBeenCalledTimes(2)
    expect(response.responseKind).toBe('records')
    expect(response.cards[0].bookings[0].link).toContain(booking.publicId)
    expect(Date.now() - started).toBe(18500)
  })
})

test('two stalled generations stop at the original total deadline with no committed data', async () => {
  await withTurnClock(45000, async () => {
    const generate = model(stalledGeneration)
    const started = Date.now(), pending = ask()
    const rejected = expect(pending).rejects.toMatchObject({ assistantStatus: 'unavailable', status: 503, message: expect.stringMatching(/too long/i) })
    await jest.advanceTimersByTimeAsync(44999)
    expect(generate).toHaveBeenCalledTimes(2)
    expect(generate.mock.calls[1][0].signal.aborted).toBe(false)
    await jest.advanceTimersByTimeAsync(1)
    await rejected
    expect(Date.now() - started).toBe(45000)
    expect(generate).toHaveBeenCalledTimes(2)
    const session = [..._store.values()][0]
    expect(session.history).toEqual([])
    expect(session.refs.size).toBe(0)
    expect(session.turns).toBe(0)
  })
})

test('cancel during first-attempt timeout backoff stops recovery before another generation', async () => {
  await withTurnClock(45000, async () => {
    const ac = new AbortController(), generate = model(stalledGeneration)
    const pending = ask({ signal: ac.signal })
    const rejected = expect(pending).rejects.toMatchObject({ assistantStatus: 'cancelled' })
    await jest.advanceTimersByTimeAsync(18000)
    expect(generate.mock.calls[0][0].signal.reason).toBe('attempt_timeout')
    ac.abort()
    await rejected
    await jest.advanceTimersByTimeAsync(1000)
    expect(generate).toHaveBeenCalledTimes(1)
    expect([..._store.values()][0].turns).toBe(0)
  })
})

test.each([1200, 22000])('a configured %sms deadline is not replaced by the eighteen-second cap', async timeoutMs => {
  await withTurnClock(timeoutMs, async () => {
    const generate = model(stalledGeneration)
    const pending = ask()
    const rejected = expect(pending).rejects.toMatchObject({ assistantStatus: 'unavailable', status: 503 })
    await jest.advanceTimersByTimeAsync(timeoutMs - 1)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate.mock.calls[0][0].signal.aborted).toBe(false)
    await jest.advanceTimersByTimeAsync(1)
    await rejected
    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate.mock.calls[0][0].signal.reason).toBe('timeout')
  })
})

test('overload and stalled-generation recovery share the same single retry budget', async () => {
  await withTurnClock(45000, async () => {
    let attempts = 0
    const generate = model(async request => {
      if (attempts++ === 0) throw new ProviderError('unavailable', 'Synthetic overload', { transient: true, httpStatus: 503 })
      return stalledGeneration(request)
    })
    const pending = ask()
    const rejected = expect(pending).rejects.toMatchObject({ assistantStatus: 'unavailable', status: 503 })
    await jest.advanceTimersByTimeAsync(18000)
    expect(generate).toHaveBeenCalledTimes(2)
    expect(generate.mock.calls[1][0].signal.aborted).toBe(false)
    await jest.advanceTimersByTimeAsync(27000)
    await rejected
    expect(generate).toHaveBeenCalledTimes(2)
  })
})

test('a longer turn permits a third generation to recover within the same sixty-second budget', async () => {
  await withTurnClock(60000, async () => {
    let attempts = 0
    const generate = model(async request => {
      if (attempts++ < 2) return stalledGeneration(request)
      return { parts: [call('list_bookings'), call('finish_lookup')] }
    })
    const started = Date.now(), pending = ask()
    await jest.advanceTimersByTimeAsync(36999)
    expect(generate).toHaveBeenCalledTimes(2)
    expect(generate.mock.calls[0][0].signal.reason).toBe('attempt_timeout')
    expect(generate.mock.calls[1][0].signal.reason).toBe('attempt_timeout')
    await jest.advanceTimersByTimeAsync(1)
    const response = await pending
    expect(generate).toHaveBeenCalledTimes(3)
    expect(response.cards[0].bookings[0].link).toContain(booking.publicId)
    expect(Date.now() - started).toBe(37000)
  })
})

test('three stalled generations still terminate exactly at the sixty-second total deadline', async () => {
  await withTurnClock(60000, async () => {
    const generate = model(stalledGeneration)
    const started = Date.now(), pending = ask()
    const rejected = expect(pending).rejects.toMatchObject({ assistantStatus: 'unavailable', status: 503 })
    await jest.advanceTimersByTimeAsync(59999)
    expect(generate).toHaveBeenCalledTimes(3)
    expect(generate.mock.calls[2][0].signal.aborted).toBe(false)
    await jest.advanceTimersByTimeAsync(1)
    await rejected
    expect(Date.now() - started).toBe(60000)
    expect(generate).toHaveBeenCalledTimes(3)
    const session = [..._store.values()][0]
    expect(session.history).toEqual([])
    expect(session.refs.size).toBe(0)
    expect(session.turns).toBe(0)
  })
})

test('an overload followed by stalls cannot create more than three attempts in a longer turn', async () => {
  await withTurnClock(60000, async () => {
    let attempts = 0
    const generate = model(async request => {
      if (attempts++ === 0) throw new ProviderError('unavailable', 'Synthetic overload', { transient: true, httpStatus: 503 })
      return stalledGeneration(request)
    })
    const pending = ask()
    const rejected = expect(pending).rejects.toMatchObject({ assistantStatus: 'unavailable', status: 503 })
    await jest.advanceTimersByTimeAsync(60000)
    await rejected
    expect(generate).toHaveBeenCalledTimes(3)
  })
})

test('an overload close to an attempt cap does not turn retry backoff into a false user cancellation', async () => {
  await withTurnClock(60000, async () => {
    let attempts = 0
    const generate = model(async () => {
      if (attempts++ === 0) return new Promise((_, reject) => setTimeout(() => reject(new ProviderError('unavailable', 'Late overload', { transient: true, httpStatus: 503 })), 17750))
      return { parts: [call('list_bookings'), call('finish_lookup')] }
    })
    const pending = ask()
    await jest.advanceTimersByTimeAsync(18250)
    const response = await pending
    expect(generate).toHaveBeenCalledTimes(2)
    expect(response.responseKind).toBe('records')
  })
})

test.each([
  ['blocked', null, 503], ['bad_response', null, 503], ['rate_limit', 429, 429],
])('a %s response is never retried even in a longer turn', async (kind, httpStatus, status) => {
  const saved = env.ai.timeoutMs
  env.ai.timeoutMs = 60000
  const generate = model(async () => { throw new ProviderError(kind, 'Synthetic non-retryable response', { transient: true, httpStatus }) })
  try {
    await expect(ask()).rejects.toMatchObject({ assistantStatus: 'unavailable', status })
    expect(generate).toHaveBeenCalledTimes(1)
  } finally { env.ai.timeoutMs = saved }
})
