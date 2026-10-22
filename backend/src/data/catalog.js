import { LOCATIONS } from './areas.js'
import { resolvePlace } from '../services/places.service.js'

// Static lists shared by the browse filters, the matching wizard, the chatbot and the seed script.
// Kept in one place so the frontend dropdowns (served by GET /api/parent/catalog) never drift from the DB values.

// Every subject a student can be taught, in the order they are offered. Covers what Malaysian primary and secondary
// (PT3 / SPM) students are tutored in. Added to this list, a subject shows up everywhere: child profiles, Find a Tutor,
// the wizard, the chatbot and the tutor profile setup.
export const SUBJECTS = [
  'Mathematics', 'English', 'Bahasa Melayu', 'Science', 'Chinese', 'Tamil', 'History',
  'Additional Mathematics', 'Physics', 'Chemistry', 'Biology', 'Computer Science',
  'Geography', 'Economics', 'Principles of Accounting', 'Business',
  'Literature in English', 'Islamic Education', 'Moral Education',
]

// Where each subject exists in school, so a parent of a Primary 3 child is not offered Physics and a Form 5 student
// is offered Additional Mathematics and the SPM electives. (A level that is not listed here has no such subject.)
const ALL = ['KINDERGARTEN', 'PRIMARY', 'SECONDARY']
const PRIMARY_UP = ['PRIMARY', 'SECONDARY']
export const SUBJECT_LEVELS = {
  Mathematics: ALL, English: ALL, 'Bahasa Melayu': ALL, Chinese: ALL, Tamil: ALL,
  Science: PRIMARY_UP, History: PRIMARY_UP, 'Computer Science': PRIMARY_UP, 'Islamic Education': PRIMARY_UP, 'Moral Education': PRIMARY_UP,
  'Additional Mathematics': ['SECONDARY'], Physics: ['SECONDARY'], Chemistry: ['SECONDARY'], Biology: ['SECONDARY'],
  Geography: ['SECONDARY'], Economics: ['SECONDARY'], 'Principles of Accounting': ['SECONDARY'], Business: ['SECONDARY'],
  'Literature in English': ['SECONDARY'],
}
export const subjectsForLevel = (level) => SUBJECTS.filter((s) => SUBJECT_LEVELS[s]?.includes(level))
export const isSubjectAtLevel = (subject, level) => Boolean(SUBJECT_LEVELS[subject]?.includes(level))

// A child can need help in several subjects (at most this many, so a profile stays meaningful)
export const MAX_CHILD_SUBJECTS = 6

// Highest grade per level: Kindergarten 1-3, Primary 1-6, Secondary (Form) 1-5
export const MAX_GRADE = { KINDERGARTEN: 3, PRIMARY: 6, SECONDARY: 5 }

export const CHARACTERISTICS = ['Patient & Encouraging', 'Structured', 'Exam-Focused', 'Interactive']

// Languages a tutor can teach in (tutor profile setup)
export const LANGUAGES = ['English', 'Bahasa Melayu', 'Mandarin', 'Tamil', 'Cantonese']

export { LOCATIONS }

// Any place a person can pick: a named neighbourhood above, or any town or postcode in Malaysia (places.service.js)
export const findLocation = (name) => resolvePlace(name)
