// Country codes for the phone box. Malaysia comes first because most users are there; the rest are the countries
// parents and tutors in Malaysia most often have numbers from. Written as ISO letters (MY, SG...), not flag pictures,
// because Windows does not draw flag emoji.
export const COUNTRIES = [
  { iso: 'MY', dial: '60', name: 'Malaysia', example: '12-345 6789' },
  { iso: 'SG', dial: '65', name: 'Singapore', example: '9123 4567' },
  { iso: 'BN', dial: '673', name: 'Brunei', example: '712 3456' },
  { iso: 'ID', dial: '62', name: 'Indonesia', example: '812 3456 7890' },
  { iso: 'TH', dial: '66', name: 'Thailand', example: '81 234 5678' },
  { iso: 'PH', dial: '63', name: 'Philippines', example: '912 345 6789' },
  { iso: 'VN', dial: '84', name: 'Vietnam', example: '912 345 678' },
  { iso: 'CN', dial: '86', name: 'China', example: '138 0013 8000' },
  { iso: 'HK', dial: '852', name: 'Hong Kong', example: '5123 4567' },
  { iso: 'TW', dial: '886', name: 'Taiwan', example: '912 345 678' },
  { iso: 'IN', dial: '91', name: 'India', example: '98765 43210' },
  { iso: 'JP', dial: '81', name: 'Japan', example: '90 1234 5678' },
  { iso: 'KR', dial: '82', name: 'South Korea', example: '10 1234 5678' },
  { iso: 'AU', dial: '61', name: 'Australia', example: '412 345 678' },
  { iso: 'GB', dial: '44', name: 'United Kingdom', example: '7400 123456' },
  { iso: 'US', dial: '1', name: 'United States / Canada', example: '415 555 2671' },
]

const MALAYSIA = COUNTRIES[0]
const byLongestDial = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length)

// "+6591234567" -> { country: SG, national: "91234567" }. Anything that is not an international number is read as
// Malaysian (a number typed the local way, like 012-345 6789, or an older record).
export function splitPhone(value) {
  const text = String(value || '').trim()
  if (text.startsWith('+')) {
    const digits = text.replace(/\D/g, '')
    const country = byLongestDial.find((c) => digits.startsWith(c.dial))
    // A country code that is not in the list: keep the whole number, shown with Malaysia's box, so nothing is lost
    if (country) return { country, national: digits.slice(country.dial.length) }
    return { country: MALAYSIA, national: text }
  }
  return { country: MALAYSIA, national: text }
}

// The number the server gets: "+" + country code + the digits typed (a leading 0 is the national "dial this first"
// digit, which is not part of the international number)
export function joinPhone(country, national) {
  const typed = String(national || '').trim()
  // If someone pastes a whole international number, believe the "+": it is more reliable than the dropdown
  if (typed.startsWith('+')) return typed
  // Only digits and the usual separators (space - ( ) .) can be part of a number. Anything else, such as letters, is kept
  // in the value instead of being dropped, so the form's check refuses it rather than quietly saving a different number.
  if (hasForbiddenCharacters(typed)) return `+${country.dial}${typed}`
  const digits = typed.replace(/\D/g, '').replace(/^0+/, '')
  return digits ? `+${country.dial}${digits}` : ''
}

// True when the text has something in it that can never be part of a phone number (letters, symbols...)
export const hasForbiddenCharacters = (text) => /[^\d\s\-().+]/.test(String(text || ''))
