// Places a person can pick as "my area": any postcode or town in Malaysia, plus a few well-known neighbourhoods.
// Everything is in memory (about 2,800 postcodes), so a search takes well under a millisecond and needs no outside service.
//
// A place is saved as its label, for example:
//   "Kepong, Kuala Lumpur"        a named neighbourhood (data/areas.js)
//   "Shah Alam, Selangor"         a town (the centre of all its postcodes)
//   "42700 Banting, Selangor"     one postcode (the most exact choice)
// resolvePlace(label) turns a saved label back into coordinates, which is what the tutor distance uses.
import { createRequire } from 'node:module'
import { LOCATIONS } from '../data/areas.js'

const require = createRequire(import.meta.url)
const data = require('../data/places.json') // { source, builtOn, columns, places: [[postcode, city, state, lat, lng]] }

// "Kuala Lumpur, Kuala Lumpur" reads badly: a town named like its state is written once
const label = (city, state) => (city === state ? city : `${city}, ${state}`)

// Lower case, no accents, only letters and digits, so "Pulau  Pinang" and "pulau pinang" are the same
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Other ways people write or say the same place. They are searched but never shown, so typing "penang", "george town",
// "kl" or "malacca" finds the place the data calls "Pulau Pinang", "Kuala Lumpur" or "Melaka".
const STATE_WORDS = { 'Pulau Pinang': 'penang', Melaka: 'malacca', 'Kuala Lumpur': 'kl', Johor: 'johore' }
const TOWN_WORDS = {
  'Pulau Pinang|Pulau Pinang': 'penang george town georgetown',
  'Johor Bahru|Johor': 'jb johore bahru johore',
  'Petaling Jaya|Selangor': 'pj',
  'Kota Kinabalu|Sabah': 'kk jesselton',
  'Kota Bharu|Kelantan': 'kota bahru',
  'Kota Bahru|Kelantan': 'kota bharu',
  'Kuala Lumpur|Kuala Lumpur': 'kl',
  'Melaka|Melaka': 'malacca melaka',
  'Shah Alam|Selangor': 'sa',
  'Subang Jaya|Selangor': 'sj usj',
}
const extra = (city, state) => `${TOWN_WORDS[`${city}|${state}`] || ''} ${STATE_WORDS[state] || ''}`

const entries = []
const byLabel = new Map()
const add = (e) => {
  if (byLabel.has(e.label)) return
  byLabel.set(e.label, e)
  entries.push(e)
}

// 1. Named neighbourhoods
for (const a of LOCATIONS) {
  const [place, state] = [a.name.split(', ')[0], a.name.split(', ').at(-1)]
  add({
    kind: 'area', label: a.name, state, lat: a.lat, lng: a.lng,
    text: norm(`${a.name} ${extra(place, state)}`),
    // Some of these are towns too (Petaling Jaya, Klang...): they keep the town's nicknames
    nicknames: norm(TOWN_WORDS[`${place}|${state}`] || ''),
  })
}

// 2. Towns: one per (town, state), placed at the average of its postcodes
const towns = new Map()
for (const [postcode, city, state, lat, lng] of data.places) {
  const key = `${city}|${state}`
  const t = towns.get(key) || { city, state, lat: 0, lng: 0, count: 0 }
  t.lat += lat
  t.lng += lng
  t.count += 1
  towns.set(key, t)
}
for (const t of towns.values()) {
  add({
    kind: 'town', label: label(t.city, t.state), state: t.state, lat: t.lat / t.count, lng: t.lng / t.count, count: t.count,
    text: norm(`${t.city} ${t.state} ${extra(t.city, t.state)}`),
    nicknames: norm(TOWN_WORDS[`${t.city}|${t.state}`] || ''), // what people call this town: "kl", "jb", "penang"
  })
}

// 3. Postcodes: the most exact choice, at the postcode's own coordinates
const postcodes = []
for (const [postcode, city, state, lat, lng] of data.places) {
  const e = { kind: 'postcode', label: `${postcode} ${label(city, state)}`, state, postcode, lat, lng, text: norm(`${postcode} ${city} ${state} ${extra(city, state)}`) }
  add(e)
  postcodes.push(e)
}

export const STATES = [...new Set(data.places.map((p) => p[2]))].sort((a, b) => a.localeCompare(b))
export const placesInfo = { source: data.source, builtOn: data.builtOn, count: data.places.length }

// Saved label -> { name, lat, lng } (or null when it is not a place we know). Same shape as the old area list.
export function resolvePlace(name) {
  const e = typeof name === 'string' ? byLabel.get(name.trim()) : null
  return e ? { name: e.label, lat: Math.round(e.lat * 1e4) / 1e4, lng: Math.round(e.lng * 1e4) / 1e4 } : null
}

const KIND_ORDER = { area: 0, town: 1, postcode: 2 }
const view = (e) => ({ label: e.label, kind: e.kind, state: e.state })

// What to show before anything is typed: the neighbourhoods first, then the biggest towns
const popularList = [
  ...entries.filter((e) => e.kind === 'area').slice(0, 6),
  ...entries.filter((e) => e.kind === 'town').sort((a, b) => b.count - a.count).slice(0, 8),
]
export const popularPlaces = () => popularList.map(view)

// Search by town, neighbourhood or postcode (or part of them), optionally inside one state.
//  - digits only:  postcodes that start with them ("521" -> 52100, 52200...)
//  - words:        every word must start a word of the place ("shah" finds Shah Alam; "kota k" finds Kota Kinabalu)
//  - towns and neighbourhoods are offered before the long list of postcodes
export function searchPlaces(query, { state, limit = 8 } = {}) {
  const q = norm(query || '')
  if (!q) return popularPlaces().filter((p) => !state || p.state === state).slice(0, limit)
  const inState = (e) => !state || e.state === state
  const max = Math.min(Math.max(Number(limit) || 8, 1), 20)

  if (/^\d+$/.test(q)) {
    return postcodes.filter((e) => inState(e) && e.postcode.startsWith(q)).slice(0, max).map(view)
  }

  const words = q.split(' ')
  const scored = []
  for (const e of entries) {
    if (!inState(e)) continue
    const tokens = e.text.split(' ')
    // every typed word must be the start of one of the place's words
    if (!words.every((w) => tokens.some((t) => t.startsWith(w)))) continue
    let score = KIND_ORDER[e.kind] * 100
    if (e.text.startsWith(q)) score -= 40 // starts with what was typed: "kep" -> Kepong before "Sungai Kepong"
    if (norm(e.label) === q) score -= 60
    // "kl" is Kuala Lumpur, not Klang, and "pen" is probably Penang: a nickname (whole, or its first 3+ letters) beats everything else
    if (e.nicknames && (e.nicknames === q || e.nicknames.split(' ').some((n) => n === q || (q.length >= 3 && n.startsWith(q))))) score -= 150
    score += Math.min(e.text.length, 60) / 10 // shorter names first
    if (e.count) score -= Math.min(e.count, 200) / 40 // among equal matches, the bigger town first
    scored.push([score, e])
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].label.localeCompare(b[1].label))
  return scored.slice(0, max).map(([, e]) => view(e))
}
