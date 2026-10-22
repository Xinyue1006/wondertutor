import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { CHARACTERISTICS, LANGUAGES, LOCATIONS, MAX_GRADE, SUBJECTS, SUBJECT_LEVELS } from '../../data/catalog.js'
import { cloudinaryUrl, hourlyRate, optionalText, personName, phoneMY, yearsExperience } from '../../utils/validators.js'
import * as setup from '../../services/tutorSetup.service.js'

// GET /tutor/catalog: option lists for the setup wizard
export function catalog(req, res) {
  res.json({ subjects: SUBJECTS, subjectLevels: SUBJECT_LEVELS, locations: LOCATIONS.map((l) => l.name), characteristics: CHARACTERISTICS, languages: LANGUAGES, maxGrade: MAX_GRADE })
}

// GET /tutor/profile: the setup draft, its verification status and what is still missing before submit
export async function getProfile(req, res) {
  res.json(setup.toSetupDto(await setup.loadSetup(req.tutor.id)))
}

const subjectRow = z
  .object({
    subject: z.enum(SUBJECTS, { message: 'Choose a subject from the list' }),
    educationLevel: z.enum(['KINDERGARTEN', 'PRIMARY', 'SECONDARY']),
    minGrade: z.number().int().min(1),
    maxGrade: z.number().int().min(1),
  })
  .refine((s) => s.minGrade <= s.maxGrade, { message: 'The first grade must not be after the last grade', path: ['maxGrade'] })
  .refine((s) => s.maxGrade <= MAX_GRADE[s.educationLevel], { message: 'That grade does not exist for the chosen level', path: ['maxGrade'] })

// Every field is optional so each wizard step saves only its own part
const profileSchema = z
  .object({
    fullName: personName('Full name'),
    phone: phoneMY('Phone number'),
    profilePhotoUrl: cloudinaryUrl('Profile photo').nullable(),
    gender: z.enum(['MALE', 'FEMALE', 'UNSPECIFIED']),
    emergencyContactName: personName('Emergency contact name'),
    emergencyContactPhone: phoneMY('Emergency contact number'),
    location: z.string().trim().max(100).nullable(),
    bio: optionalText(2000, 'About me'),
    teachingApproach: optionalText(2000, 'Teaching approach'),
    yearsExperience,
    hourlyRate,
    offersPhysical: z.boolean(),
    offersOnline: z.boolean(),
    languages: z.array(z.enum(LANGUAGES, { message: 'Choose a language from the list' })).max(LANGUAGES.length),
    characteristics: z.array(z.enum(CHARACTERISTICS, { message: 'Choose a teaching style from the list' })).max(CHARACTERISTICS.length),
    subjects: z.array(subjectRow).max(12, 'Up to 12 subjects'),
  })
  .partial()
  .strict()

// PUT /tutor/profile: partial save of the setup draft (also used to edit the profile later)
export async function updateProfile(req, res) {
  const data = profileSchema.parse(req.body)
  // An emergency contact is someone else, so it cannot be the tutor's own number
  const ownPhone = data.phone ?? req.user.phone
  const contactPhone = data.emergencyContactPhone ?? req.tutor.emergencyContactPhone
  if (ownPhone && contactPhone && ownPhone === contactPhone)
    throw new AppError(400, 'The emergency contact number must be different from your own number')
  // Turning both modes off would leave nothing for parents to book
  const physical = data.offersPhysical ?? req.tutor.offersPhysical
  const online = data.offersOnline ?? req.tutor.offersOnline
  if (!physical && !online) throw new AppError(400, 'Choose physical, online or both')

  res.json(setup.toSetupDto(await setup.saveProfile(req.tutor, data)))
}

const documentSchema = z.object({
  kind: z.enum(['QUALIFICATION', 'IDENTITY'], { message: 'Choose the document type' }),
  title: z.string().trim().min(2, 'Enter the document name').max(120, 'Document name must be 120 characters or fewer'),
  institution: optionalText(120, 'Institution'),
  year: z.number().int().min(1950, 'Enter a valid year').max(new Date().getFullYear(), 'The year cannot be in the future').optional().nullable(),
  documentUrl: cloudinaryUrl('Document'),
})

// POST /tutor/documents: a qualification or identity document for Admin to review (starts as PENDING)
export async function addDocument(req, res) {
  const doc = await setup.addDocument(req.tutor, documentSchema.parse(req.body))
  res.status(201).json({ id: doc.id })
}

// DELETE /tutor/documents/:id -> { ok, isVerified } (isVerified turns false when the last approved ID or qualification goes)
export async function removeDocument(req, res) {
  const { isVerified } = await setup.removeDocument(req.tutor, Number(req.params.id))
  res.json({ ok: true, isVerified })
}

const portfolioSchema = z.object({
  title: z.string().trim().min(2, 'Enter a title').max(120, 'Title must be 120 characters or fewer'),
  description: optionalText(500, 'Description'),
  fileUrl: cloudinaryUrl('File'),
})

// POST /tutor/portfolio
export async function addPortfolioItem(req, res) {
  const item = await setup.addPortfolioItem(req.tutor, portfolioSchema.parse(req.body))
  res.status(201).json({ id: item.id })
}

// DELETE /tutor/portfolio/:id
export async function removePortfolioItem(req, res) {
  await setup.removePortfolioItem(req.tutor, Number(req.params.id))
  res.json({ ok: true })
}

// POST /tutor/submit-for-verification: checks the setup is complete and sends it to Admin
export async function submitForVerification(req, res) {
  res.json(setup.toSetupDto(await setup.submitForVerification(req.tutor)))
}

// GET /tutor/dashboard: headline numbers for the tutor home page (verified tutors only)
export async function dashboard(req, res) {
  const now = new Date()
  const [newRequests, upcoming] = await Promise.all([
    prisma.booking.count({ where: { tutorId: req.tutor.id, status: 'PENDING' } }),
    prisma.booking.count({ where: { tutorId: req.tutor.id, status: 'CONFIRMED', startAt: { gte: now } } }),
  ])
  res.json({ newRequests, upcomingSessions: upcoming, ratingAvg: req.tutor.ratingAvg, ratingCount: req.tutor.ratingCount })
}
