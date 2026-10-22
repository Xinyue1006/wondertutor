// A child can need help in several subjects. They are saved as a list (Child.subjects), and the first one is also kept in
// the older single column (Child.subject) so any code that still reads one subject keeps working.
import { z } from 'zod'
import { MAX_CHILD_SUBJECTS, SUBJECTS, isSubjectAtLevel } from '../data/catalog.js'

const LEVEL_WORD = { KINDERGARTEN: 'Kindergarten', PRIMARY: 'Primary', SECONDARY: 'Secondary' }

// The subjects of a child row, whether it was saved with the list, or only with one subject (older rows, the demo seed)
export const subjectsOf = (child) => (Array.isArray(child.subjects) ? child.subjects : child.subject ? [child.subject] : [])

// What a request may carry: the list, and the old single `subject` (still accepted, so older forms and the Postman examples work)
export const subjectFields = {
  subjects: z
    .array(z.enum(SUBJECTS, { message: 'Choose the subjects from the list' }), { message: 'Choose the subjects from the list' })
    .max(MAX_CHILD_SUBJECTS, `Choose up to ${MAX_CHILD_SUBJECTS} subjects`)
    .optional(),
  subject: z.enum(SUBJECTS, { message: 'Choose the subjects from the list' }).optional().nullable(),
}

// Both fields merged into one list without repeats, in the order given
export const cleanSubjects = ({ subjects, subject }) => [...new Set([...(subjects ?? []), ...(subject ? [subject] : [])])]

// A subject must exist at the child's level: no Physics for a Primary 3 child. Used inside a zod superRefine.
export function checkSubjectsFitLevel(data, ctx) {
  const list = cleanSubjects(data)
  if (list.length > MAX_CHILD_SUBJECTS) ctx.addIssue({ code: 'custom', message: `Choose up to ${MAX_CHILD_SUBJECTS} subjects`, path: ['subjects'] })
  for (const s of list) {
    if (!isSubjectAtLevel(s, data.educationLevel)) {
      ctx.addIssue({ code: 'custom', message: `${s} is not taught at ${LEVEL_WORD[data.educationLevel] || 'this'} level`, path: ['subjects'] })
      return
    }
  }
}

// The two columns to write
export const subjectColumns = (list) => ({ subjects: list, subject: list[0] ?? null })
