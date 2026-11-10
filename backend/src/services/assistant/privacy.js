// Data minimisation before anything is sent to the AI provider.
//
// Two layers:
//   1. Tools only return the fields a question needs (no photos, GPS, gateway references, raw rows, whole profiles).
//   2. Free text (the parent's message, lesson summaries, notification titles, complaint replies) is passed through
//      redactText(): known names become conversation references like [[child_1]], and emails, phone numbers, links,
//      long numbers and street-level address fragments are masked.
//
// Automated redaction is best effort: it cannot recognise every way a person or place can be written. That is why the
// feature is OFF by default and docs/AI_ASSISTANT.md asks for a deployment review before real child data is used.
// Replacing names with references reduces exposure; it does NOT make the data anonymous.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi
// Malaysian and international phone formats: +60 12-345 6789, 012-3456789, 03 1234 5678 ...
const PHONE = /(?:\+?\d{1,3}[\s-]?)?(?:\(?0?\d{1,3}\)?[\s-]?)\d{3,4}[\s-]?\d{3,4}\b/g
const LONG_NUMBER = /\b\d{6,}\b/g
const POSTCODE = /\b\d{5}\b/g
// "No. 12, Jalan Mawar 3" / "Lot 5" / "Unit 3-2" / "Jalan Kepong 4/2": street-level detail, not the area name
const STREET = /\b(?:no\.?|lot|unit|blok|block)\s*[\w/-]*\d[\w/-]*,?\s*/gi
const JALAN = /\b(?:jalan|jln\.?|lorong|persiaran|lebuh)\s+[^,.\n]{1,40}/gi

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// names: array of [displayName, replacement]. Longest names first so "Tan Hui Wen" wins over "Tan".
export function redactText(input, { names = [], max = 400 } = {}) {
  if (input == null) return null
  let t = String(input)
  t = t.replace(EMAIL, '[email]').replace(URL_RE, '[link]')
  for (const [name, token] of [...names].filter(([n]) => n && n.trim().length >= 2).sort((a, b) => b[0].length - a[0].length)) {
    // Latin-script names need word boundaries ("Ana" must not match inside "Banana"), but a boundary against ANY letter
    // would miss a name written next to Chinese characters (e.g. "给Aina找老师"), so only Latin letters/digits count
    const latin = /^[\p{Script=Latin}\s.'-]+$/u.test(name.trim())
    const pattern = latin ? `(?<![\\p{Script=Latin}\\p{N}])${escapeRe(name.trim())}(?![\\p{Script=Latin}\\p{N}])` : escapeRe(name.trim())
    t = t.replace(new RegExp(pattern, 'giu'), token)
  }
  t = t.replace(STREET, '[address] ').replace(JALAN, '[address]')
  t = t.replace(PHONE, (m) => (m.replace(/\D/g, '').length >= 8 ? '[phone]' : m))
  t = t.replace(LONG_NUMBER, '[number]').replace(POSTCODE, '[postcode]')
  t = t.replace(/\s{2,}/g, ' ').trim()
  if (t.length > max) t = `${t.slice(0, max - 1).trimEnd()}…`
  return t
}

// The name -> reference pairs known to this conversation (children, tutors) plus the parent's own name
export function namePairs(session, parentName) {
  const pairs = [...session.labels.entries()].map(([ref, label]) => [label, `[[${ref}]]`])
  if (parentName) pairs.push([parentName, '[parent]'])
  return pairs
}

// Also mask each part of a multi-word name (e.g. "Daniel" from "Daniel Tan"). A single part can belong to several
// people (many families share a surname), so parts become a neutral [name] rather than one person's reference.
export function expandNames(pairs) {
  const out = [...pairs]
  const full = new Set(pairs.map(([n]) => String(n).trim().toLowerCase()))
  for (const [name] of pairs) {
    const parts = String(name).trim().split(/\s+/)
    if (parts.length > 1) for (const p of parts) if (p.length >= 3 && !full.has(p.toLowerCase())) out.push([p, '[name]'])
  }
  return out
}

// ───────────── the single boundary before the provider ─────────────
// EVERY request to the provider passes through sanitizeContents(): the retained history, the parent's new message and
// all tool responses are re-filtered with the names known to the conversation at THAT moment (a tutor name that was
// typed earlier but only became known later is caught too). Gemini protocol fields are never touched: function names,
// call ids, function-call args produced by the model, and thought signatures are passed through byte for byte.
// The input is not mutated (history and UI cards stay as they are); a filtered copy is returned.
// Structured values that are never personal text; leaving them alone keeps dates, times, enums and references intact
const STRUCTURED = /^(?:\d{4}-\d{2}-\d{2}|\d{2}:\d{2}|[A-Z][A-Z_]+|[a-z]+_\d+|\[\[[a-z]+_\d+\]\])$/

function redactValue(v, opts) {
  if (typeof v === 'string') return STRUCTURED.test(v) ? v : redactText(v, opts)
  if (Array.isArray(v)) return v.map((x) => redactValue(x, opts))
  if (v && typeof v === 'object') {
    const out = {}
    for (const [k, x] of Object.entries(v)) out[k] = redactValue(x, opts)
    return out
  }
  return v
}

export function sanitizeContents(contents, names) {
  const opts = { names, max: 8000 }
  return contents.map((c) => ({
    ...c,
    parts: (c.parts || []).map((p) => {
      if (!p || typeof p !== 'object') return p
      if (p.functionCall) return p // the model's own call and its thoughtSignature: protocol data, unchanged
      const out = { ...p }
      if (typeof p.text === 'string' && !p.thought) out.text = redactText(p.text, opts)
      if (p.functionResponse) out.functionResponse = { ...p.functionResponse, response: redactValue(p.functionResponse.response, opts) }
      return out
    }),
  }))
}
