// Billplz (Malaysian payment gateway: FPX online banking, e-wallets such as TNG/Boost/GrabPay, cards if the account enables them).
// Only this file knows how Billplz works, so the rest of the system just asks "create a bill" and "is it paid?".
// Docs: https://www.billplz.com/api  (the sandbox lives at billplz-sandbox.com, so no real money moves while developing)
import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'

export const billplzConfigured = () => Boolean(env.billplz.apiKey && env.billplz.collectionId)

// Billplz uses HTTP Basic auth: the API key is the user name and the password is empty
const authHeader = () => `Basic ${Buffer.from(`${env.billplz.apiKey}:`).toString('base64')}`

async function call(path, options = {}) {
  const res = await fetch(`${env.billplz.baseUrl}${path}`, { ...options, headers: { Authorization: authHeader(), ...options.headers } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = body?.error?.message
    throw new Error(`Billplz ${res.status}: ${Array.isArray(detail) ? detail.join(', ') : detail || 'request failed'}`)
  }
  return body
}

// amountCents is a whole number (RM 12.50 = 1250): Billplz wants cents, and cents never carry floating-point error
export function createBill({ email, name, amountCents, description, reference, callbackUrl, redirectUrl }) {
  const form = new URLSearchParams({
    collection_id: env.billplz.collectionId,
    email,
    name: name.slice(0, 255),
    amount: String(amountCents),
    description: description.slice(0, 200),
    callback_url: callbackUrl,
    redirect_url: redirectUrl,
    reference_1_label: 'Booking',
    reference_1: reference,
  })
  return call('/v3/bills', { method: 'POST', body: form })
}

// The bill as Billplz itself reports it. We trust this over anything the browser tells us.
export const getBill = (billId) => call(`/v3/bills/${encodeURIComponent(billId)}`)

// Billplz signs what it sends (both the browser redirect and the server callback) with the X-Signature key.
// Rule: join every field except x_signature as "name+value", sort them A-Z ignoring case, glue them with "|", HMAC-SHA256.
// The redirect names its fields "billplz[id]"; the brackets are dropped before signing.
export function signatureFor(params, key = env.billplz.xSignature) {
  const source = Object.entries(params)
    .filter(([name]) => name !== 'x_signature' && name !== 'billplz[x_signature]')
    .map(([name, value]) => `${name.replace(/[[\]]/g, '')}${value ?? ''}`)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .join('|')
  return createHmac('sha256', key).update(source).digest('hex')
}

export function signatureIsValid(params) {
  const given = String(params.x_signature ?? params['billplz[x_signature]'] ?? '')
  if (!env.billplz.xSignature || !given) return false
  const expected = signatureFor(params)
  // timingSafeEqual needs equal lengths, and avoids leaking how many characters matched
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}
