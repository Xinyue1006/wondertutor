// Regression tests for the assistant's answer evidence, provider-bound privacy and turn/state handling.
// The AI provider is ALWAYS a mock here (no live model, no cost). "Model" below means a scripted fake provider.
import { prisma } from '../config/prisma.js'
import { setProvider } from '../services/assistant/provider.js'
import { handleMessage } from '../services/assistant/orchestrator.js'
import { _clearAll, _store, deleteSession, getSession } from '../services/assistant/session.js'
import { noEvidenceText, screenModelProse, clarifyText } from '../services/assistant/answers.js'
import { MONDAY, makeBooking, makeParent, makeTutor, nextDate, resetDb } from './helpers.js'
import { addDays, mytParts, mytToDate } from '../utils/time.js'

let calls = []
function script(...steps) {
  calls = []
  let i = 0
  setProvider({
    name: 'mock',
    async generate(req) {
      calls.push(JSON.parse(JSON.stringify({ contents: req.contents })))
      const step = steps[Math.min(i++, steps.length - 1)]
      return { parts: await step(req), usage: { inputTokens: 1, outputTokens: 1 } }
    },
  })
}
const call = (name, args = {}) => () => [{ functionCall: { name, args }, thoughtSignature: 'sig-1' }]
const say = (text) => () => [{ text }]
const lastResponse = (req) => [...req.contents].reverse().find((c) => c.role === 'user' && c.parts.some((p) => p.functionResponse)).parts.find((p) => p.functionResponse).functionResponse.response
const turn = (who, message, extra = {}) => handleMessage({ user: who.user, parent: who.parent, body: { message, ...extra } })
const stored = (who, id) => getSession(id, who.user, who.parent)

let P
let tutor
const TUTOR_NAME = 'Quentin Okonkwo-Vasquez'

beforeAll(async () => {
  await resetDb()
  P = await makeParent({ child: { name: 'Sarah' } })
  await prisma.user.update({ where: { id: P.user.id }, data: { fullName: 'Tan Xin Yue' } })
  tutor = await makeTutor({ rate: 55 })
  await prisma.user.update({ where: { id: tutor.user.id }, data: { fullName: TUTOR_NAME } })
})
afterAll(() => { setProvider(null); return prisma.$disconnect() })
beforeEach(() => _clearAll())

// ───────────────────────── 1. unsupported factual answers ─────────────────────────
describe('1. account facts come from evidence, not from the model', () => {
  const INVENTED = [
    'Your next lesson is tomorrow at 9pm.',
    'Your refund has been approved.',
    'Your child improved dramatically.',
    'RM100 has been paid.',
  ]
  test.each(INVENTED)('model text without any tool evidence is replaced: %s', async (claim) => {
    script(say(claim))
    const res = await turn(P, 'tell me about my account')
    expect(res.text).toBe(noEvidenceText('en'))
    expect(res.text).not.toMatch(/9pm|approved|dramatically|RM100/)
    expect(res.cards).toEqual([])
  })

  test('invented completion of an action is replaced in English, Malay and Chinese', async () => {
    const cases = [
      ['en', 'I have booked the lesson and paid for you.', 'please book Monday'],
      ['ms', 'Saya sudah tempah kelas itu dan telah bayar.', 'tolong tempah kelas hari Isnin'],
      ['zh', '已为您预约并付款成功。', '请帮我预约星期一的课'],
    ]
    for (const [lang, claim, ask] of cases) {
      script(say(claim))
      const res = await turn(P, ask)
      expect(res.text).toBe(noEvidenceText(lang))
      expect(res.text).not.toBe(claim)
    }
  })

  test('with evidence, a completed-action claim from the model is never shown', async () => {
    script(call('list_notifications'), say('I have cancelled your lesson and marked everything as read.'))
    const res = await turn(P, 'any notifications?')
    expect(res.text).toMatch(/unread notification/)
    expect(res.text).not.toMatch(/cancelled|marked/)
  })

  test('the correct amount cannot be attached to the wrong child or period', async () => {
    const today = mytParts(new Date()).date
    const monthStart = mytToDate(`${today.slice(0, 8)}01`, '00:00')
    const b = await makeBooking({ parent: P.parent, child: P.child, tutor: tutor.tutor, date: addDays(today, -60), status: 'COMPLETED', price: 50 })
    await prisma.payment.create({ data: { bookingId: b.id, amount: 50, commissionRate: 10, commissionAmount: 5, status: 'PAID', paidAt: new Date(monthStart.getTime() + 3600_000) } })
    // the model has the real number (RM50) but pins it to another child and another month
    script(call('get_payment_summary'), say('[[child_9]] paid RM50 last month; RM500 is pending.'))
    const res = await turn(P, 'how much did I pay this month?')
    expect(res.text).toContain('This month')
    expect(res.text).toContain('RM50.00 paid in 1 payment')
    expect(res.text).toContain('RM0.00 waiting for payment')
    expect(res.text).not.toMatch(/last month|500|child_9/)
  })

  test('an incorrect lesson date/time from the model is replaced by the recorded one', async () => {
    const date = nextDate(MONDAY)
    await makeBooking({ parent: P.parent, child: P.child, tutor: tutor.tutor, date, status: 'CONFIRMED', price: 55 })
    script(call('list_bookings'), say('[[child_1]] has a lesson tomorrow at 9pm.'))
    const res = await turn(P, 'when is the next lesson?')
    expect(res.text).toContain(`on ${date} at 17:00`)
    expect(res.text).not.toMatch(/tomorrow|9pm/)
  })

  test('an incorrect refund status from the model is replaced by the recorded one', async () => {
    const payment = await prisma.payment.findFirst({ where: { booking: { parentId: P.parent.id } } })
    await prisma.refund.create({ data: { paymentId: payment.id, amount: 20, type: 'ADMIN_REVIEW', reason: 'test reason here', status: 'APPROVED' } })
    script(call('list_payment_refunds'), say('Your refund was rejected and RM999 was paid back.'))
    const res = await turn(P, 'what happened to my refund?')
    expect(res.text).toContain('RM20.00 approved')
    expect(res.text).not.toMatch(/rejected|999/)
    expect(res.text).toContain('not proof that money has reached your account')
  })

  test('an unsupported progress claim is replaced by the recorded counts', async () => {
    script(call('get_learning_progress'), say('[[child_1]] improved dramatically and is top of the class.'))
    const res = await turn(P, 'is Sarah improving?')
    expect(res.text).toContain('1 completed lesson')
    expect(res.text).toContain('0 with a tutor summary')
    expect(res.text).toContain('not marks or a measure of improvement')
    expect(res.text).not.toMatch(/dramatically|top of the class|improved/)
  })

  test('a missing record gives a clear missing-data answer in the parent\'s language', async () => {
    script(call('get_lesson_details', { bookingRef: 'booking_99' }), say('The lesson went well and was paid.'))
    const en = await turn(P, 'show lesson 99')
    expect(en.text).toMatch(/couldn't find a matching record/)
    script(call('get_lesson_details', { bookingRef: 'booking_99' }), say('x'))
    expect((await turn(P, '显示第99节课')).text).toMatch(/没有找到/)
  })

  test('supported answers still work: server sentences for facts, model wording for clarification', async () => {
    const date = nextDate(MONDAY)
    script(call('list_bookings'), say('anything'))
    const ms = await turn(P, 'bila kelas anak saya yang seterusnya?')
    expect(ms.text).toContain('Saya menjumpai')
    expect(ms.text).toContain(date)
    expect(ms.cards.find((c) => c.type === 'booking_list')).toBeTruthy()

    script(call('search_tutors', { level: 'PRIMARY' }), say('Which subject should I look for?'))
    const ask = await turn(P, 'find me a tutor')
    expect(ask.text).toBe('Which subject should I look for?') // natural clarification kept

    script(call('search_tutors', { level: 'PRIMARY' }), say('Great, 3 tutors found for you!'))
    const bad = await turn(P, 'find me a tutor')
    expect(bad.text).toBe(clarifyText('subject', 'en')) // an unsafe clarification is swapped for a safe template
  })

  test('matching-weight numbers are not accepted as payment amounts', () => {
    const session = { refs: new Map() }
    for (const t of ['RM30 was paid', 'You owe 15%', '20% refund approved']) expect(screenModelProse(t, session).ok).toBe(false)
  })

  test('the screen rejects account claims in Malay and Chinese too', () => {
    const session = { refs: new Map() }
    expect(screenModelProse('Bayaran anda telah diluluskan.', session).ok).toBe(false)
    expect(screenModelProse('您的退款已批准。', session).ok).toBe(false)
    expect(screenModelProse('孩子进步很大。', session).ok).toBe(false)
    expect(screenModelProse('Saya boleh bantu anda mencari tutor.', session).ok).toBe(true)
  })
})

// ───────────────────────── 2. provider-bound history is alias-only ─────────────────────────
describe('2. real names and contact details never reach the provider', () => {
  const PARTS = ['Quentin', 'Okonkwo', 'Vasquez']
  const search = { subject: 'Mathematics', level: 'PRIMARY', grade: 5 }

  test('a match explanation shown to the parent keeps the real name in the UI only; the next provider payload is alias-only', async () => {
    script(call('search_tutors', search), (req) => {
      const r = lastResponse(req)
      return [{ functionCall: { name: 'explain_tutor_match', args: { searchRef: r.searchRef, tutorRef: r.tutors[0].tutorRef } } }]
    }, say('ok'))
    const first = await turn(P, 'why is the first tutor ranked top? my email is mum@example.com, call 012-345 6789')
    // UI: the authorised name is available to the browser through entities + trusted cards
    const refMatch = first.text.match(/\[\[(tutor_\d+)\]\]/)
    expect(refMatch).toBeTruthy()
    expect(first.entities[refMatch[1]]).toBe(TUTOR_NAME)
    expect(first.cards.find((c) => c.type === 'match_explanation').name).toBe(TUTOR_NAME) // trusted card untouched
    expect(first.cards.find((c) => c.type === 'tutor_results').tutors[0].name).toBe(TUTOR_NAME)
    expect(first.text).not.toMatch(/Quentin|Okonkwo/)

    script(say('Happy to help.'))
    await turn(P, 'and what about the second one?', { conversationId: first.conversationId })
    const outgoing = JSON.stringify(calls)
    for (const part of PARTS) expect(outgoing).not.toContain(part)
    expect(outgoing).not.toMatch(/mum@example\.com|012-345 6789|0123456789/)
    expect(outgoing).toContain('[[tutor_1]]') // alias is what the model sees
  })

  test('a name typed BEFORE it was known is filtered from retained history once it becomes known', async () => {
    script(say('Sure.'))
    const one = await turn(P, `Do you know ${TUTOR_NAME}? Reach me on mum@example.com`)
    script(call('search_tutors', search), say('ok'))
    await turn(P, 'find a Maths tutor for Primary 5', { conversationId: one.conversationId })
    script(say('fine'))
    await turn(P, 'thanks', { conversationId: one.conversationId })
    const outgoing = JSON.stringify(calls)
    for (const part of PARTS) expect(outgoing).not.toContain(part)
    expect(outgoing).not.toContain('mum@example.com')
  })

  test('tool responses are filtered at the boundary, and protocol fields (thoughtSignature, function name/args) are untouched', async () => {
    script(call('list_children'), say('ok'))
    await turn(P, 'list my children')
    const second = calls.at(-1).contents
    const modelPart = second.find((c) => c.role === 'model').parts[0]
    expect(modelPart.thoughtSignature).toBe('sig-1')
    expect(modelPart.functionCall).toEqual({ name: 'list_children', args: {} })
    expect(second.at(-1).parts[0].functionResponse.name).toBe('list_children')
  })

  test('other fallback paths (no evidence, clarification, missing record, tool loop) never put a name in history', async () => {
    const one = await turn(P, 'hello') // provider returns nothing useful -> template
    script(call('list_bookings'), say('x'))
    const two = await turn(P, 'next lesson?', { conversationId: one.conversationId })
    const history = JSON.stringify(stored(P, two.conversationId).history)
    for (const part of [...PARTS, 'Sarah', 'Tan Xin Yue']) expect(history).not.toContain(part)
    expect(history).toContain('[[child_1]]')
  })
})

// ───────────────────────── 4. cancellation, failure, concurrency ─────────────────────────
describe('4. turns are staged, one at a time, and cancel/failure leave no trace', () => {
  const gate = () => { let release; const p = new Promise((r) => { release = r }); return { p, release } }
  const searchArgs = { subject: 'Mathematics', level: 'PRIMARY', grade: 5, days: [1] }

  async function firstSearch() {
    script(call('search_tutors', searchArgs), say('ok'))
    const r = await turn(P, 'maths tutor primary 5 monday')
    return r.conversationId
  }

  test('a successful turn commits its state (refs, searches, criteria, history)', async () => {
    const id = await firstSearch()
    const s = stored(P, id)
    expect(s.lastCriteria).toMatchObject({ subject: 'Mathematics', days: [1] })
    expect(s.searches.size).toBe(1)
    expect(s.refs.has('tutor_1')).toBe(true)
    expect(s.history).toHaveLength(2)
    expect(s.turns).toBe(1)
    expect(s.active).toBeNull()
  })

  test('cancelled before the first provider call: provider never called, nothing stored', async () => {
    const ac = new AbortController()
    ac.abort('cancelled')
    script(say('never'))
    await expect(handleMessage({ user: P.user, parent: P.parent, body: { message: 'hi' }, signal: ac.signal })).rejects.toMatchObject({ assistantStatus: 'cancelled' })
    expect(calls).toHaveLength(0)
    const s = [..._store.values()][0]
    expect(s.history).toHaveLength(0)
    expect(s.active).toBeNull()
  })

  test('cancelled between tool calls: later tools do not run and no search is stored', async () => {
    const ac = new AbortController()
    const db = new Proxy(prisma, {
      get: (t, k) => (k === 'notification' ? { ...t.notification, count: async (...a) => { const r = await t.notification.count(...a); ac.abort('cancelled'); return r } } : t[k]),
    })
    setProvider({ name: 'mock', generate: async () => ({ parts: [{ functionCall: { name: 'list_notifications', args: {} } }, { functionCall: { name: 'search_tutors', args: searchArgs } }] }) })
    await expect(handleMessage({ user: P.user, parent: P.parent, body: { message: 'x' }, signal: ac.signal, db })).rejects.toMatchObject({ assistantStatus: 'cancelled' })
    const s = [..._store.values()][0]
    expect(s.searches.size).toBe(0)
    expect(s.lastCriteria).toBeNull()
    expect(s.history).toHaveLength(0)
  })

  test('a cancelled or failed search does not change the next refinement', async () => {
    const id = await firstSearch()
    // (a) failed: the tool ran, then the provider failed
    let n = 0
    setProvider({ name: 'mock', generate: async () => { if (n++ === 0) return { parts: [{ functionCall: { name: 'search_tutors', args: { mode: 'ONLINE', budgetMax: 20 } } }] }; throw new Error('boom') } })
    await expect(turn(P, 'online under 20', { conversationId: id })).rejects.toBeTruthy()
    // (b) cancelled after the tool ran
    const ac = new AbortController()
    let m = 0
    setProvider({ name: 'mock', generate: async () => { if (m++ === 0) return { parts: [{ functionCall: { name: 'search_tutors', args: { gender: 'MALE' } } }] }; ac.abort('cancelled'); return { parts: [{ text: 'late' }] } } })
    await expect(handleMessage({ user: P.user, parent: P.parent, body: { message: 'male only', conversationId: id }, signal: ac.signal })).rejects.toMatchObject({ assistantStatus: 'cancelled' })
    const s = stored(P, id)
    expect(s.lastCriteria).toMatchObject({ mode: 'EITHER', gender: 'ANY', budgetMax: null, days: [1] })
    expect(s.searches.size).toBe(1)
    expect(s.history).toHaveLength(2)
    // the next refinement builds on the LAST COMPLETED search only
    script(call('search_tutors', { budgetMax: 70 }), say('ok'))
    const r = await turn(P, 'under 70', { conversationId: id })
    expect(r.criteria).toMatchObject({ subject: 'Mathematics', days: [1], mode: 'EITHER', gender: 'ANY', budgetMax: 70 })
  })

  test('overlapping turns on one conversation: the second is a retryable conflict and cannot overwrite the first', async () => {
    const id = await firstSearch()
    const g = gate()
    setProvider({ name: 'mock', generate: async () => { await g.p; return { parts: [{ text: 'Sure, happy to help.' }] } } })
    const a = turn(P, 'first question', { conversationId: id })
    await new Promise((r) => setTimeout(r, 30))
    setProvider({ name: 'mock', generate: async () => ({ parts: [{ text: 'Second answer.' }] }) })
    await expect(turn(P, 'second question', { conversationId: id })).rejects.toMatchObject({ assistantStatus: 'busy', status: 409 })
    g.release()
    const ra = await a
    expect(ra.text).toBe('Sure, happy to help.')
    const h = JSON.stringify(stored(P, id).history)
    expect(h).toContain('first question')
    expect(h).not.toContain('second question')
    expect(stored(P, id).turns).toBe(2)
  })

  test('cancel A then start B: B proceeds at once and A can no longer commit', async () => {
    const id = await firstSearch()
    const acA = new AbortController()
    const g = gate()
    setProvider({ name: 'mock', generate: async () => { await g.p; return { parts: [{ text: 'Answer for A.' }] } } })
    const a = handleMessage({ user: P.user, parent: P.parent, body: { message: 'question A', conversationId: id }, signal: acA.signal })
    a.catch(() => {})
    await new Promise((r) => setTimeout(r, 30))
    acA.abort('cancelled')
    setProvider({ name: 'mock', generate: async () => ({ parts: [{ text: 'Answer for B.' }] }) })
    const b = await turn(P, 'question B', { conversationId: id })
    expect(b.text).toBe('Answer for B.')
    g.release() // A's provider finishes late
    await expect(a).rejects.toMatchObject({ assistantStatus: 'cancelled' })
    const h = JSON.stringify(stored(P, id).history)
    expect(h).toContain('question B')
    expect(h).not.toContain('question A')
  })

  test('clearing the chat while a request runs: the deleted conversation is not resurrected or committed', async () => {
    const id = await firstSearch()
    const g = gate()
    setProvider({ name: 'mock', generate: async () => { await g.p; return { parts: [{ text: 'Answer.' }] } } })
    const a = turn(P, 'question', { conversationId: id })
    a.catch(() => {})
    await new Promise((r) => setTimeout(r, 30))
    expect(deleteSession(id, P.user, P.parent)).toBe(true)
    g.release()
    await expect(a).rejects.toMatchObject({ assistantStatus: 'cancelled', status: 404 })
    expect(getSession(id, P.user, P.parent)).toBeNull()
    expect([..._store.values()].some((s) => s.id === id)).toBe(false)
  })
})
