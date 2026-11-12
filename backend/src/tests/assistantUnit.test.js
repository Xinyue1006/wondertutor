// Unit tests for the assistant building blocks that do not need the database.
import { redactText, expandNames } from '../services/assistant/privacy.js'
import { readAiConfig, env } from '../config/env.js'
import { screenModelProse } from '../services/assistant/answers.js'
import { createSession, getSession, refFor, resolveRef, _clearAll, _store } from '../services/assistant/session.js'
import { searchFaq, FAQ } from '../services/assistant/faq.js'
import { executeTool, toolDeclarations, TOOLS } from '../services/assistant/tools.js'
import { toolArgs } from '../services/assistant/schemas.js'
import { rateLimit } from '../middleware/rateLimit.js'

test('assistant tools reject impossible calendar dates before querying records', () => {
  for (const tool of ['list_bookings', 'get_learning_progress', 'get_payment_summary']) {
    expect(toolArgs[tool].safeParse({ from: '2026-02-31' }).success).toBe(false)
    expect(toolArgs[tool].safeParse({ from: '2026-02-28' }).success).toBe(true)
  }
})

describe('redaction', () => {
  test('names become references; contact details and street addresses are masked; text is bounded', () => {
    const names = expandNames([['Sarah', '[[child_1]]'], ['Daniel Tan', '[[tutor_1]]']])
    const out = redactText('Sarah (sarah@mail.com, +60 12-345 6789) lives at No. 5, Jalan Ipoh 2, 51200 KL. Daniel Tan said hi; Daniel too. https://x.io/a', { names, max: 500 })
    expect(out).toContain('[[child_1]]')
    expect(out).toContain('[[tutor_1]]')
    expect(out).toContain('[name] too')
    for (const leak of ['sarah@mail.com', '12-345', 'Jalan Ipoh', '51200', 'https://']) expect(out).not.toContain(leak)
    expect(redactText('a'.repeat(1000), { max: 50 })).toHaveLength(50)
  })
  test('a name written next to Chinese text is still replaced, without matching inside longer Latin words', () => {
    expect(redactText('给Aina找科学老师', { names: [['Aina', '[[child_1]]']] })).toBe('给[[child_1]]找科学老师')
    expect(redactText('Banana for Ana', { names: [['Ana', '[[child_2]]']] })).toBe('Banana for [[child_2]]')
  })
  test('dates, times and amounts stay readable', () => {
    expect(redactText('Lesson on 2026-11-02 at 17:00, RM55.00')).toBe('Lesson on 2026-11-02 at 17:00, RM55.00')
  })
})

describe('configuration', () => {
  test('disabled mode needs no key; enabled mode without key/model refuses to start', () => {
    expect(readAiConfig({}).enabled).toBe(false)
    expect(() => readAiConfig({ AI_ASSISTANT_ENABLED: 'true' })).toThrow(/GEMINI_API_KEY/)
    expect(() => readAiConfig({ AI_ASSISTANT_ENABLED: 'true', GEMINI_API_KEY: 'k', GEMINI_MODEL: 'm', AI_MAX_TOOL_ROUNDS: '99' })).toThrow(/AI_MAX_TOOL_ROUNDS/)
    expect(readAiConfig({ AI_ASSISTANT_ENABLED: 'true', GEMINI_API_KEY: 'k', GEMINI_MODEL: 'some-model' })).toMatchObject({ enabled: true, timeoutMs: 60000, maxToolRounds: 4 })
  })
})

describe('sessions', () => {
  beforeEach(_clearAll)
  const user = { id: 1 }
  const parent = { id: 10 }
  test('bound to user + parent, expire, and refs only resolve inside their conversation', () => {
    const s = createSession(user, parent, Date.now())
    expect(getSession(s.id, { id: 2 }, parent)).toBeNull()
    expect(getSession(s.id, user, { id: 11 })).toBeNull()
    const ref = refFor(s, 'child', 99, 'Sarah')
    expect(resolveRef(s, 'child', ref)).toBe(99)
    expect(resolveRef(s, 'booking', ref)).toBeNull()
    const other = createSession(user, parent)
    expect(resolveRef(other, 'child', ref)).toBeNull()
    expect(getSession(s.id, user, parent, Date.now() + env.ai.conversationTtlMs + 1)).toBeNull()
  })
  test('per-user cap evicts the oldest conversation', () => {
    for (let i = 0; i < env.ai.maxConversationsPerUser + 2; i++) createSession(user, parent, Date.now() + i)
    expect([..._store.values()].filter((s) => s.userId === 1)).toHaveLength(env.ai.maxConversationsPerUser)
  })
  test('conversation ids are long random strings', () => {
    const a = createSession(user, parent).id
    expect(a).toMatch(/^[A-Za-z0-9_-]{24,}$/)
  })
})

describe('model prose screen (used only when a turn has no account evidence)', () => {
  const session = { refs: new Map([['child_1', { kind: 'child', id: 1 }]]) }
  test('accepts plain, fact-free wording', () => {
    expect(screenModelProse('Which subject do you need?', session).ok).toBe(true)
    expect(screenModelProse('I can look things up for [[child_1]], but I cannot book or pay.', session).ok).toBe(true)
  })
  test('rejects figures, unknown references, account claims and completed-action claims', () => {
    expect(screenModelProse('You paid RM56', session).ok).toBe(false)
    expect(screenModelProse('[[child_2]] needs help', session).reason).toBe('unknown_ref')
    expect(screenModelProse("I've cancelled it for you", session).reason).toBe('write_claim')
    expect(screenModelProse('Your refund has been approved.', session).ok).toBe(false)
  })
})

describe('tool registry', () => {
  test('every declared tool has a strict argument schema; nothing that writes is declared', () => {
    const names = toolDeclarations().map((t) => t.name)
    expect(names.sort()).toEqual(Object.keys(toolArgs).sort())
      for (const n of names) expect(n === 'finish_lookup' || /^(list|get|search|explain)_/.test(n)).toBe(true)
    expect(Object.keys(TOOLS)).not.toEqual(expect.arrayContaining(['create_booking']))
  })
  test('unknown tools and prototype names fail closed', async () => {
    for (const name of ['create_booking', '__proto__', 'constructor', 'toString']) {
      expect((await executeTool({}, name, {})).result.error).toBe('unknown_tool')
    }
    expect((await executeTool({}, 'search_faq', { question: 'refund', extra: 1 })).result.error).toBe('invalid_arguments')
  })
})

describe('FAQ', () => {
  test('every entry is traceable and reviewed; search finds policy answers in several languages', () => {
    for (const e of FAQ) expect(e).toMatchObject({ id: expect.stringMatching(/^faq\./), source: expect.any(String), reviewed: expect.any(String) })
    expect(searchFaq('how do refunds work?')[0].id).toBe('faq.cancel-refund')
    expect(searchFaq('boleh batal?')[0].id).toBe('faq.cancel-refund')
    expect(searchFaq('试课要钱吗')[0].id).toBe('faq.trial-lesson')
    expect(searchFaq('qwertyuiop')).toEqual([])
  })
  test('no FAQ answer promises an automatic refund for every parent cancellation', () => {
    const text = FAQ.map((e) => e.answer).join(' ')
    expect(text).not.toMatch(/automatic(ally)? (full )?refund(ed)? (for|when) (every|any|all) (parent )?cancel/i)
  })
})

describe('per-user message limit', () => {
  test('the 11th message in a minute gets 429', () => {
    const limiter = rateLimit({ name: 't', windowMs: 60_000, max: 10, keyBy: (req) => req.user.id, enabled: true })
    const results = []
    for (let i = 0; i < 11; i++) limiter({ user: { id: 7 } }, { set() {} }, (err) => results.push(err?.status ?? 200))
    expect(results.at(-1)).toBe(429)
    expect(results.slice(0, 10).every((s) => s === 200)).toBe(true)
  })
})
