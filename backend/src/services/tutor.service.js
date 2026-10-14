// Shapes TutorProfile rows into the JSON the Parent Portal needs (cards + public profile).
import { dayName } from './matching.service.js'

export const tutorInclude = {
  user: { select: { fullName: true, profilePhotoUrl: true, status: true } },
  subjects: true,
  availability: true,
  qualifications: true,
}

const LEVEL_SHORT = { KINDERGARTEN: 'Kindergarten', PRIMARY: 'Primary', SECONDARY: 'Secondary' }
const ORDER = { KINDERGARTEN: 0, PRIMARY: 1, SECONDARY: 2 }

// "Primary 4 – 6" / "Primary 5 – Secondary 3" / "Secondary 1 – 5" (the wording used on the cards)
export function levelsLabel(subjects, subjectName) {
  const rows = subjects
    .filter((s) => !subjectName || s.subject === subjectName)
    .sort((a, b) => ORDER[a.educationLevel] - ORDER[b.educationLevel] || a.minGrade - b.minGrade)
  if (!rows.length) return ''
  const one = (r) =>
    r.educationLevel === 'KINDERGARTEN'
      ? 'Kindergarten'
      : r.minGrade === r.maxGrade
        ? `${LEVEL_SHORT[r.educationLevel]} ${r.minGrade}`
        : `${LEVEL_SHORT[r.educationLevel]} ${r.minGrade} – ${r.maxGrade}`
  if (rows.length === 2 && rows[0].educationLevel === 'PRIMARY' && rows[1].educationLevel === 'SECONDARY' && rows[0].maxGrade === 6 && rows[1].minGrade === 1)
    return `Primary ${rows[0].minGrade} – Secondary ${rows[1].maxGrade}`
  return rows.map(one).join(', ')
}

export const availableDays = (availability) =>
  [...new Set(availability.map((a) => a.dayOfWeek))]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) // Monday first
    .map(dayName)

export function toTutorCard(t, subjectName) {
  const subjects = [...new Set(t.subjects.map((s) => s.subject))]
  return {
    id: t.id,
    name: t.user.fullName,
    photoUrl: t.user.profilePhotoUrl,
    verified: t.isVerified,
    rating: Math.round(t.ratingAvg * 10) / 10,
    reviewCount: t.ratingCount,
    hourlyRate: Number(t.hourlyRate),
    subjects,
    mainSubject: subjectName && subjects.includes(subjectName) ? subjectName : subjects[0],
    levels: levelsLabel(t.subjects, subjectName && subjects.includes(subjectName) ? subjectName : subjects[0]),
    offersOnline: t.offersOnline,
    offersPhysical: t.offersPhysical,
    location: t.location,
    availableDays: availableDays(t.availability),
    yearsExperience: t.yearsExperience,
    characteristics: t.characteristics || [],
    gender: t.gender,
  }
}

// Full public profile (About / Teaching Information / Availability tabs)
export function toTutorProfile(t, extra = {}) {
  const card = toTutorCard(t)
  const levelRows = t.subjects.map((s) => ({ level: s.educationLevel, min: s.minGrade, max: s.maxGrade }))
  const grades = []
  for (const r of levelRows)
    for (let g = r.min; g <= r.max; g++)
      grades.push(r.level === 'SECONDARY' ? `Form ${g}` : r.level === 'KINDERGARTEN' ? `Kindergarten ${g}` : `Primary ${g}`)
  // Approved qualifications first; ones still waiting for Admin are shown with their status. Rejected ones never are.
  const order = { APPROVED: 0, PENDING: 1 }
  const quals = t.qualifications.filter((q) => q.status !== 'REJECTED').sort((a, b) => order[a.status] - order[b.status]).map((q) => ({
    id: q.id, title: q.title, institution: q.institution, year: q.year, status: q.status,
  }))
  const startYear = new Date().getFullYear() - t.yearsExperience
  const levelWords = [...new Set(t.subjects.map((s) => LEVEL_SHORT[s.educationLevel].toLowerCase()))]

  return {
    ...card,
    bio: t.bio,
    teachingApproach: (t.teachingApproach || '').split('\n').map((s) => s.trim()).filter(Boolean),
    achievements: t.achievements || [],
    languages: t.languages || [],
    qualifications: quals,
    experienceText: {
      headline: `${t.yearsExperience}+ years of tutoring experience`,
      detail: `${levelWords.join(' and ').replace(/^./, (c) => c.toUpperCase())} students`,
      period: `(${startYear} – Present)`,
    },
    grades: [...new Set(grades)],
    ...extra,
  }
}
