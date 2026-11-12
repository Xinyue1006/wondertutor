// Read-only AI assistant endpoints (Phase 1). Mounted under /api/parent/assistant, so requireAuth + PARENT role +
// loadParentProfile already ran: req.user is the logged-in user and req.parent their parent profile.
import { env } from '../../config/env.js'
import { AppError } from '../../utils/AppError.js'
import { handleMessage } from '../../services/assistant/orchestrator.js'
import { deleteSession } from '../../services/assistant/session.js'
import { getProvider } from '../../services/assistant/provider.js'
import { PROMPT_VERSION } from '../../services/assistant/prompt.js'
import { FAQ_VERSION } from '../../services/assistant/faq.js'
import { suggestedQuestions } from '../../services/assistant/conversation.js'

// GET /parent/assistant/capabilities: what the widget may offer. Never includes keys or provider details beyond a name.
export function capabilities(req, res) {
  const provider = getProvider()
  const enabled = env.ai.enabled || provider.name !== 'gemini' // a mock provider in tests counts as enabled
  res.json({
    enabled,
    modes: enabled ? ['ai', 'guided'] : ['guided'],
    readOnly: true,
    suggestions: suggestedQuestions('en'),
    limits: { requestTimeoutMs: env.ai.timeoutMs, maxMessageLength: 2000, maxTurns: env.ai.maxTurns, conversationMinutes: Math.round(env.ai.conversationTtlMs / 60000) },
    limitations: [
      'Read-only: it can look things up but cannot book, cancel, pay, change profiles or file complaints.',
      'Answers come from your WonderTutor records and approved policy answers only.',
      'Chats are temporary and are cleared after a period of inactivity or a server restart.',
    ],
    versions: { prompt: PROMPT_VERSION, faq: FAQ_VERSION },
  })
}

// POST /parent/assistant/messages
export async function postMessage(req, res) {
  const ac = new AbortController()
  // The browser cancelled (or the connection dropped): stop the model loop and do not store this turn
  res.on('close', () => { if (!res.writableEnded) ac.abort() })
  try {
    const reply = await handleMessage({ user: req.user, parent: req.parent, body: req.body, signal: ac.signal })
    res.json(reply)
  } catch (err) {
    if (err?.assistantStatus === 'cancelled') {
      // Browser cancelled: nobody is listening. Chat deleted while the request ran: tell the caller so the request does not hang.
      if (res.destroyed || res.writableEnded || res.headersSent) return
      return res.status(err.status === 404 ? 404 : 499).json({ status: 'cancelled', message: err.message })
    }
    if (err?.assistantStatus === 'busy') {
      // One question at a time per chat: a retryable conflict, the chat itself is untouched
      return res.status(409).json({ status: 'busy', retryable: true, message: err.message, conversationId: err.conversationId })
    }
    if (err?.assistantStatus === 'unavailable') {
      return res.status(err.status).json({ status: 'unavailable', message: err.message, ...(err.conversationId && { conversationId: err.conversationId }) })
    }
    throw err
  }
}

// DELETE /parent/assistant/conversations/:conversationId: removes this parent's temporary chat only
export function deleteConversation(req, res) {
  const id = String(req.params.conversationId || '')
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id) || !deleteSession(id, req.user, req.parent)) throw new AppError(404, 'Conversation not found')
  res.json({ ok: true })
}
