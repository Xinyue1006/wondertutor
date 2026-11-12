// Exact, product-owned questions can use the same validated read tools without
// waiting for a language model to select them. This is not a general intent
// classifier: custom, compound, qualified or action requests still use Gemini.
import { QUESTIONS } from './conversation.js'

const INTENTS = ['lesson', 'homework', 'payments', 'matching']
const normalize = value => String(value || '').normalize('NFKC').trim().toLowerCase()
  .replace(/[?？!！.。]+$/gu, '').replace(/\s+/g, ' ').trim()

export const QUICK_QUESTIONS = Object.freeze(Object.entries(QUESTIONS).flatMap(([lang, questions]) =>
  INTENTS.map(intent => Object.freeze({ intent, lang, text: questions[intent] })),
))
const approved = new Map(QUICK_QUESTIONS.map(question => [normalize(question.text), question]))

export function approvedQuickQuestion(message) {
  const text = normalize(message)
  return text && text.length <= 160 ? approved.get(text) || null : null
}

// read() is supplied by the orchestrator and always runs executeTool(), including
// strict argument validation, ownership, limits and cancellation checks. No raw
// database identifier or executable tool name comes from the message itself.
export async function executeQuickQuestion(question, ctx, read) {
  const child = ctx.selectedChildRef ? { childRef: ctx.selectedChildRef } : {}
  switch (question.intent) {
    case 'lesson':
      await read('list_bookings', { ...child, when: 'upcoming', limit: 1 })
      break
    case 'homework': {
      const listed = await read('list_bookings', { ...child, when: 'past', status: 'COMPLETED', limit: 1 })
      const ref = listed.ok && listed.result.bookings?.[0]?.bookingRef
      if (ref) await read('get_lesson_details', { bookingRef: ref })
      break
    }
    case 'payments':
      // The existing tool's empty validated arguments mean the current Malaysian
      // calendar month, using the same payment-date rules as the Payments page.
      await read('get_payment_summary', {})
      break
    case 'matching':
      await read('search_tutors', { ...child, subject: 'Mathematics', level: 'PRIMARY', grade: 4 })
      break
    default:
      throw new Error('Unknown approved quick question')
  }
}
