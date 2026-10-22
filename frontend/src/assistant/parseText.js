// Very small rule-based reader for the chatbot's free-text box.
// It only looks for keywords (subject, level, days, mode, budget, location, tutor gender).
// This is NOT machine learning: anything it cannot read is simply asked again with quick-reply buttons.
import { DAY_SHORT } from '../lib/format'

const DAY_WORDS = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
}

// Other ways parents say a subject: short forms, Malay names (Sejarah, Fizik, Kimia...) and the SPM subject names
const SUBJECT_ALIASES = {
  maths: 'Mathematics', math: 'Mathematics', matematik: 'Mathematics', bm: 'Bahasa Melayu', 'bahasa melayu': 'Bahasa Melayu',
  'bahasa malaysia': 'Bahasa Melayu', mandarin: 'Chinese', 'add maths': 'Additional Mathematics', 'additional maths': 'Additional Mathematics',
  'add math': 'Additional Mathematics', 'matematik tambahan': 'Additional Mathematics', bi: 'English', 'bahasa inggeris': 'English',
  sains: 'Science', sejarah: 'History', fizik: 'Physics', kimia: 'Chemistry', biologi: 'Biology', geografi: 'Geography', ekonomi: 'Economics',
  cs: 'Computer Science', computing: 'Computer Science', 'sains komputer': 'Computer Science', ict: 'Computer Science', coding: 'Computer Science',
  accounting: 'Principles of Accounting', accounts: 'Principles of Accounting', 'prinsip akaun': 'Principles of Accounting', perakaunan: 'Principles of Accounting',
  perniagaan: 'Business', literature: 'Literature in English', kesusasteraan: 'Literature in English', 'pendidikan islam': 'Islamic Education',
  'pendidikan moral': 'Moral Education', moral: 'Moral Education',
}

export function parseText(text, catalog) {
  const t = ` ${text.toLowerCase()} `
  const found = {}
  const notes = []

  // Subject: longest alias/name first so "additional mathematics" wins over "mathematics"
  const names = [
    ...Object.entries(SUBJECT_ALIASES),
    ...(catalog?.subjects || []).map((s) => [s.toLowerCase(), s]),
  ].sort((a, b) => b[0].length - a[0].length)
  const subject = names.find(([k]) => new RegExp(`\\b${k}\\b`).test(t))
  if (subject) { found.subject = subject[1]; notes.push(subject[1]) }

  // Level + grade: "primary 5", "p5", "form 2", "secondary 3", "kindergarten"
  let m = t.match(/\b(?:primary|pri|year|standard|std)\s*([1-6])\b/) || t.match(/\bp([1-6])\b/)
  if (m) { found.level = 'PRIMARY'; found.grade = Number(m[1]); notes.push(`Primary ${m[1]}`) }
  else if ((m = t.match(/\b(?:form|secondary|sec)\s*([1-5])\b/) || t.match(/\bf([1-5])\b/))) {
    found.level = 'SECONDARY'; found.grade = Number(m[1]); notes.push(`Form ${m[1]}`)
  } else if (/\b(kindergarten|kindy|tadika|preschool)\b/.test(t)) {
    found.level = 'KINDERGARTEN'; notes.push('Kindergarten')
  } else if (/\bprimary\b/.test(t)) found.level = 'PRIMARY'
  else if (/\bsecondary\b/.test(t)) found.level = 'SECONDARY'

  // Days
  const days = new Set()
  for (const [w, d] of Object.entries(DAY_WORDS)) if (new RegExp(`\\b${w}\\b`).test(t)) days.add(d)
  if (/\bweekends?\b/.test(t)) { days.add(0); days.add(6) }
  if (/\bweekdays?\b/.test(t)) [1, 2, 3, 4, 5].forEach((d) => days.add(d))
  if (days.size) { found.days = [...days].sort(); notes.push(found.days.map((d) => DAY_SHORT[d]).join(', ')) }

  // Time of day
  if (/\b(evenings?|nights?)\b/.test(t)) Object.assign(found, { timePreset: 'EVENING', timeStart: '18:00', timeEnd: '20:00' })
  else if (/\bafternoons?\b/.test(t)) Object.assign(found, { timePreset: 'AFTERNOON', timeStart: '14:00', timeEnd: '17:00' })
  else if (/\bmornings?\b/.test(t)) Object.assign(found, { timePreset: 'MORNING', timeStart: '09:00', timeEnd: '12:00' })

  // Teaching mode
  if (/\bonline\b/.test(t)) { found.mode = 'ONLINE'; notes.push('Online') }
  else if (/\b(physical|face[- ]to[- ]face|in[- ]person|home)\b/.test(t)) { found.mode = 'PHYSICAL'; notes.push('Physical') }

  // Budget: "rm60", "under rm70", "rm40-80", "40 to 80"
  const range = t.match(/rm\s*(\d+)\s*(?:-|to|–)\s*(?:rm\s*)?(\d+)/) || t.match(/(\d+)\s*(?:-|to|–)\s*(\d+)\s*(?:rm|ringgit|\/\s*h)/)
  const single = t.match(/(?:under|below|max|within|up to|budget(?: of)?)\s*(?:rm)?\s*(\d+)/) || t.match(/rm\s*(\d+)/)
  if (range) { found.budgetMin = Number(range[1]); found.budgetMax = Number(range[2]); notes.push(`RM${range[1]}–RM${range[2]}/hour`) }
  else if (single) { found.budgetMin = 20; found.budgetMax = Number(single[1]); notes.push(`up to RM${single[1]}/hour`) }

  // Tutor gender (soft preference)
  if (/\b(female|woman|lady|she)\b/.test(t)) found.gender = 'FEMALE'
  else if (/\b(male tutor|man|he)\b/.test(t) && !/\bfemale\b/.test(t)) found.gender = 'MALE'

  // Location: any known area mentioned by its first word (e.g. "kepong")
  const loc = (catalog?.locations || []).find((l) => t.includes(l.split(',')[0].toLowerCase()))
  if (loc) { found.location = loc; notes.push(loc.split(',')[0]) }

  // Teaching style keywords
  const chars = []
  if (/\b(patient|encouraging|gentle)\b/.test(t)) chars.push('Patient & Encouraging')
  if (/\bstructured\b/.test(t)) chars.push('Structured')
  if (/\b(exam|spm|upsr|ujian)\b/.test(t)) chars.push('Exam-Focused')
  if (/\b(interactive|fun)\b/.test(t)) chars.push('Interactive')
  if (chars.length) { found.characteristics = chars; notes.push(chars.join(', ')) }

  return { found, notes }
}
