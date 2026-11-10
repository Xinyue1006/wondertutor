// The Gemini adapter against a local fake HTTP server (no real API): request shape, key header, part passthrough and
// error mapping. Checks the REST code path that the mocked orchestration tests skip.
import http from 'node:http'
import { geminiProvider, ProviderError } from '../services/assistant/provider.js'

let server, base, seen, reply
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      seen = { url: req.url, headers: req.headers, body: JSON.parse(body || '{}') }
      const [status, json] = reply()
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(typeof json === 'string' ? json : JSON.stringify(json))
    })
  })
  await new Promise((r) => server.listen(0, r))
  base = `http://127.0.0.1:${server.address().port}/v1beta`
})
afterAll(() => new Promise((r) => server.close(r)))

const cfg = () => ({ enabled: true, apiKey: 'test-key', model: 'my-model', baseUrl: base, maxOutputTokens: 100 })

test('sends system instruction, contents and function declarations with the key in a header', async () => {
  const parts = [{ functionCall: { name: 'list_bookings', args: {} }, thoughtSignature: 'abc' }]
  reply = () => [200, { candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 } }]
  const out = await geminiProvider(cfg()).generate({ system: 'rules', contents: [{ role: 'user', parts: [{ text: 'hi' }] }], tools: [{ name: 'list_bookings', description: 'd', parameters: { type: 'OBJECT', properties: {} } }] })
  expect(seen.url).toBe('/v1beta/models/my-model:generateContent')
  expect(seen.headers['x-goog-api-key']).toBe('test-key')
  expect(seen.url).not.toContain('test-key')
  expect(seen.body.systemInstruction.parts[0].text).toBe('rules')
  expect(seen.body.tools[0].functionDeclarations[0].name).toBe('list_bookings')
  expect(seen.body.generationConfig.maxOutputTokens).toBe(100)
  expect(out.parts).toEqual(parts) // thoughtSignature kept for the next request
  expect(out.usage).toEqual({ inputTokens: 12, outputTokens: 3 })
})

test('maps errors to safe categories without exposing the provider body', async () => {
  const p = geminiProvider(cfg())
  const run = () => p.generate({ system: 's', contents: [], tools: [] })
  reply = () => [429, { error: { message: 'quota for key test-key' } }]
  await expect(run()).rejects.toMatchObject({ kind: 'rate_limit', transient: true })
  reply = () => [503, {}]
  await expect(run()).rejects.toMatchObject({ kind: 'unavailable', transient: true })
  reply = () => [400, { error: { message: 'secret detail' } }]
  const err = await run().catch((e) => e)
  expect(err).toBeInstanceOf(ProviderError)
  expect(err.message).not.toContain('secret detail')
  reply = () => [200, 'not json']
  await expect(run()).rejects.toMatchObject({ kind: 'bad_response' })
  reply = () => [200, { candidates: [] }]
  await expect(run()).rejects.toMatchObject({ kind: 'bad_response' })
})

test('a disabled or unconfigured provider refuses without a network call', async () => {
  seen = null
  await expect(geminiProvider({ ...cfg(), enabled: false }).generate({ system: 's', contents: [] })).rejects.toMatchObject({ kind: 'disabled' })
  expect(seen).toBeNull()
})

test.each([
  { candidates: [{ finishReason: 'PROHIBITED_CONTENT', content: {} }] },
  { promptFeedback: { blockReason: 'SAFETY' } },
])('provider safety blocks are identified without weakening settings or exposing content', async (body) => {
  reply = () => [200, body]
  await expect(geminiProvider(cfg()).generate({ system: 's', contents: [] }))
    .rejects.toMatchObject({ kind: 'blocked', transient: false })
  expect(seen.body).not.toHaveProperty('safetySettings')
})

test('a deadline abort is classified as timeout rather than user cancellation', async () => {
  await expect(geminiProvider(cfg()).generate({ system: 's', contents: [], signal: AbortSignal.abort(new DOMException('Deadline', 'TimeoutError')) }))
    .rejects.toMatchObject({ kind: 'timeout' })
})
