// AI provider adapter. The rest of the assistant talks to an interface:
//
//   provider.generate({ system, contents, tools, signal, maxOutputTokens })
//     -> { parts: [{ text } | { functionCall: { name, args }, ...}], usage: { inputTokens, outputTokens } }
//
// The real implementation calls the Gemini API generateContent REST endpoint with function declarations (backend only;
// the key never reaches the browser). Tests replace it with setProvider(mock), so CI never calls a live model.
//
// Plain fetch is used instead of an SDK to avoid adding a new dependency (project rule). Model parts are passed back to
// the API unchanged within a turn, so any thoughtSignature on a functionCall part is preserved as the Gemini docs require.
import { env } from '../../config/env.js'

export class ProviderError extends Error {
  // kind: 'timeout' | 'rate_limit' | 'unavailable' | 'blocked' | 'bad_response' | 'cancelled' | 'disabled'
  constructor(kind, message, { transient = false, httpStatus = null } = {}) {
    super(message)
    this.kind = kind
    this.transient = transient
    this.httpStatus = httpStatus
  }
}

export function geminiProvider(cfg = env.ai) {
  return {
    name: 'gemini',
    model: cfg.model,
    async generate({ system, contents, tools, signal, maxOutputTokens = cfg.maxOutputTokens }) {
      if (!cfg.enabled || !cfg.apiKey || !cfg.model) throw new ProviderError('disabled', 'AI assistant is not configured')
      const url = `${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent`
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: tools?.length ? [{ functionDeclarations: tools }] : undefined,
        toolConfig: tools?.length ? { functionCallingConfig: { mode: 'AUTO' } } : undefined,
        // Gemini 3 models recommend their default sampling settings. A forced
        // low temperature can degrade tool selection and increase latency.
        generationConfig: {
          maxOutputTokens,
          // These Flash models support minimal thinking. Keep a small lookup
          // from spending the interactive turn budget on extended reasoning.
          ...(/^gemini-3\.(?:1-flash-lite|5-flash-lite|6-flash|8-flash)$/.test(cfg.model) && {
            thinkingConfig: { thinkingLevel: 'minimal' },
          }),
        },
      }
      let res
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
          body: JSON.stringify(body),
          signal,
        })
      } catch (err) {
        if (signal?.aborted) throw new ProviderError(signal.reason === 'timeout' || signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled', 'Request stopped')
        throw new ProviderError('unavailable', 'Could not reach the AI service', { transient: true })
      }
      // Provider error bodies are never passed on (they can echo the request); only the category is reported
      if (res.status === 429) throw new ProviderError('rate_limit', 'AI service is busy', { transient: true, httpStatus: res.status })
      if (res.status >= 500) throw new ProviderError('unavailable', 'AI service error', { transient: true, httpStatus: res.status })
      if (!res.ok) throw new ProviderError('bad_response', `AI service rejected the request (${res.status})`, { httpStatus: res.status })
      let data
      try {
        data = await res.json()
      } catch {
        throw new ProviderError('bad_response', 'AI service sent an unreadable reply')
      }
      const cand = data?.candidates?.[0]
      if (['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'].includes(cand?.finishReason) || data?.promptFeedback?.blockReason) {
        throw new ProviderError('blocked', 'AI service blocked this response')
      }
      const parts = cand?.content?.parts
      if (!Array.isArray(parts)) throw new ProviderError('bad_response', 'AI service sent no answer')
      return {
        parts,
        finishReason: cand.finishReason,
        usage: { inputTokens: data?.usageMetadata?.promptTokenCount ?? null, outputTokens: data?.usageMetadata?.candidatesTokenCount ?? null },
      }
    },
  }
}

let current = null
export const getProvider = () => current || (current = geminiProvider())
// Tests (and the evaluation runner) inject a mock provider here; pass null to go back to Gemini.
export const setProvider = (p) => { current = p }
