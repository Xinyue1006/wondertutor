// A conservative public-review screen, not an AI classifier. Private complaints are deliberately not screened:
// a parent must be able to report or quote abuse to staff. Negative feedback and low ratings remain allowed.
const normalizedText = (value) => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '')
  .normalize('NFD').replace(/\p{M}/gu, '')
const canonical = (value) => normalizedText(value)
  .replace(/[0134578@$!]/g, (c) => ({ 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', '$': 's', '!': 'i' })[c])

const separated = (word) => new RegExp(`(?:^|[^a-z])${[...word].join('[\\W_]*')}(?:$|[^a-z])`, 'i')
const explicit = ['fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'bullshit', 'bitch', 'asshole', 'pukimak', 'pundek', 'kimak', 'cibai', 'sohai', 'kannina'].map(separated)
const censored = /(?:^|[^a-z])(?:f[\W_]*[u*][\W_]*c?[\W_]*k|sh[\W_]*[i*][\W_]*t|b[\W_]*[i*][\W_]*tch)(?:$|[^a-z])/i
const chineseAbuse = /傻[逼屄]|[操肏]你|他[妈媽]的|去死|死全家|[废廢]物/iu
const threats = /\b(?:kill|hurt|rape)\s+(?:you|him|her|them|your\s+(?:child|family))\b/i

export const reviewFingerprint = (value) => normalizedText(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export function reviewContentProblem(value) {
  const raw = String(value || '').trim()
  if (!raw) return null // a star-only review is valid
  const plain = normalizedText(raw)
  const normalized = canonical(raw)
  if (explicit.some((pattern) => pattern.test(plain) || pattern.test(normalized)) || censored.test(plain) || censored.test(normalized) || chineseAbuse.test(plain) || threats.test(plain)) {
    return 'Please remove abusive language or threats from your public review. To report or quote abuse, submit a private complaint instead.'
  }
  if (/https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(raw) || /(?:\+?\d[\s().-]*){9,15}/.test(raw)) {
    return 'Please remove links, email addresses and phone numbers from your public review. Keep personal details in a private complaint.'
  }
  if (/(.)\1{11,}/u.test(normalized) || /\b([a-z]{2,})(?:\s+\1){7,}\b/i.test(normalized)) {
    return 'Please describe the lesson in your own words without repeated characters or copied spam.'
  }
  return null
}
