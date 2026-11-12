// Real orchestration with pure FAQ tools and a fake provider/database: no network
// or database connection is needed to verify Gemini function-call correlation.
import { handleMessage } from '../services/assistant/orchestrator.js'
import { setProvider } from '../services/assistant/provider.js'
import { _clearAll } from '../services/assistant/session.js'

const user = { id: 812, fullName: 'Test Parent' }, parent = { id: 813 }
const db = { child: { findMany: async () => [] }, booking: { findMany: async () => [] } }
beforeEach(_clearAll)
afterEach(() => setProvider(null))

test('parallel tool responses preserve provider call IDs, names, signatures and response count, including rejected tools', async () => {
  const parts = [
    { functionCall: { id: 'call-refund', name: 'search_faq', args: { question: 'refund' } }, thoughtSignature: 'keep-signature' },
    { functionCall: { id: 'call-trial', name: 'search_faq', args: { question: 'trial lesson' } } },
    { functionCall: { id: 'call-blocked', name: 'create_booking', args: {} } },
  ]
  let round = 0, continuation
  setProvider({ name: 'mock', generate: async req => {
    if (round++ === 0) return { parts }
    continuation = req.contents
    return { parts: [{ text: 'Here is the approved information.' }] }
  } })
  await handleMessage({ user, parent, body: { message: 'Explain the refund and trial policies.' }, db })
  expect(continuation.at(-2)).toEqual({ role: 'model', parts })
  const responses = continuation.at(-1).parts.map(p => p.functionResponse)
  expect(responses.map(r => ({ id: r.id, name: r.name }))).toEqual(parts.map(p => ({ id: p.functionCall.id, name: p.functionCall.name })))
  expect(responses).toHaveLength(parts.length)
  expect(responses[0].response.entries.length).toBeGreaterThan(0)
  expect(responses[2].response.error).toBe('unknown_tool')
})

test('duplicate or invalid tool calls still receive their own matching IDs', async () => {
  let round = 0, responses
  const calls = [
    { id: 'first', name: 'search_faq', args: { question: 'refund' } },
    { id: 'duplicate', name: 'search_faq', args: { question: 'refund' } },
    { id: 'invalid', name: 'search_faq', args: { question: 'refund', malicious: true } },
  ]
  setProvider({ name: 'mock', generate: async req => {
    if (round++ === 0) return { parts: calls.map(functionCall => ({ functionCall })) }
    responses = req.contents.at(-1).parts.map(p => p.functionResponse)
    return { parts: [{ text: 'Here is the approved information.' }] }
  } })
  await handleMessage({ user, parent, body: { message: 'Explain refunds.' }, db })
  expect(responses.map(r => r.id)).toEqual(['first', 'duplicate', 'invalid'])
  expect(responses[1].response.error).toBe('duplicate_call')
  expect(responses[2].response.error).toBe('invalid_arguments')
})

test('older models without function-call IDs keep the existing protocol shape', async () => {
  let round = 0, response
  setProvider({ name: 'mock', generate: async req => {
    if (round++ === 0) return { parts: [{ functionCall: { name: 'search_faq', args: { question: 'refund' } } }] }
    response = req.contents.at(-1).parts[0].functionResponse
    return { parts: [{ text: 'Here is the approved information.' }] }
  } })
  await handleMessage({ user, parent, body: { message: 'Explain refunds.' }, db })
  expect(response.name).toBe('search_faq')
  expect(response).not.toHaveProperty('id')
})
