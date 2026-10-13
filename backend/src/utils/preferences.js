import { z } from 'zod'
import { CHARACTERISTICS } from '../data/catalog.js'

// A parent's saved tutor preferences (signup "Preferences" step / My Profile). Every field is optional because
// preferences only RANK tutors in the matching score; they never decide who is eligible. The shape is the same as the
// matching wizard's criteria so it can pre-fill the wizard directly.
export const preferencesSchema = z
  .object({
    mode: z.enum(['PHYSICAL', 'ONLINE', 'EITHER']).default('EITHER'),
    gender: z.enum(['ANY', 'MALE', 'FEMALE']).default('ANY'),
    characteristics: z.array(z.enum(CHARACTERISTICS)).max(CHARACTERISTICS.length).default([]),
    days: z.array(z.number().int().min(0).max(6)).max(7).default([]), // 0 = Sunday ... 6 = Saturday
    timePreset: z.enum(['MORNING', 'AFTERNOON', 'EVENING']).nullable().default(null),
    budgetMax: z.number().int().min(20).max(150).nullable().default(null), // RM per hour; null = no limit
  })
  .strict()

// Returns clean preferences, or null when the parent did not set anything (so "no preferences" stays null in the DB)
export function cleanPreferences(input) {
  if (input == null) return null
  const p = preferencesSchema.parse(input)
  p.days = [...new Set(p.days)].sort()
  const empty = p.mode === 'EITHER' && p.gender === 'ANY' && !p.characteristics.length && !p.days.length && !p.timePreset && p.budgetMax == null
  return empty ? null : p
}
