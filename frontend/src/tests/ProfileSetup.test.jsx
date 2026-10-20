import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

const setUser = vi.fn()
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'TUTOR', tutorStatus: 'NOT_SUBMITTED' }, setUser }) }))
vi.mock('../api/client', () => ({
  default: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
  errorMessage: (e) => e?.response?.data?.message || e.message,
}))

import api from '../api/client'
import ProfileSetup from '../pages/tutor/ProfileSetup'
import { checkStep } from '../lib/tutorSetup'

const CATALOG = {
  subjects: ['Mathematics', 'English'], locations: ['Petaling Jaya, Selangor', 'Kepong, Kuala Lumpur'],
  characteristics: ['Structured'], languages: ['English'], maxGrade: { KINDERGARTEN: 3, PRIMARY: 6, SECONDARY: 5 },
}
// A brand-new tutor straight after sign-up: only the account details exist
const NEW_TUTOR = {
  status: 'NOT_SUBMITTED', submittedAt: null, isVerified: false, fullName: 'Daniel Tan', email: 'daniel@example.com', isEmailVerified: true,
  phone: '+60123456789', profilePhotoUrl: null, gender: null, emergencyContactName: null, emergencyContactPhone: null, location: null,
  bio: null, teachingApproach: null, yearsExperience: 0, hourlyRate: 0, offersPhysical: true, offersOnline: false,
  languages: [], characteristics: [], subjects: [], documents: [], portfolio: [], missing: ['Gender'],
}
const COMPLETE = {
  ...NEW_TUTOR, gender: 'MALE', emergencyContactName: 'Lisa Tan', emergencyContactPhone: '+60120000000', location: 'Petaling Jaya, Selangor',
  bio: 'Mathematics tutor helping Form 1-5 students build confidence.', hourlyRate: 60, yearsExperience: 4,
  subjects: [{ subject: 'Mathematics', educationLevel: 'SECONDARY', minGrade: 1, maxGrade: 5 }],
  documents: [
    { id: 1, kind: 'IDENTITY', title: 'NRIC', status: 'PENDING', documentUrl: 'https://res.cloudinary.com/x/nric.pdf' },
    { id: 2, kind: 'QUALIFICATION', title: 'BSc Mathematics', status: 'PENDING', documentUrl: 'https://res.cloudinary.com/x/bsc.pdf' },
  ],
  profilePhotoUrl: 'https://res.cloudinary.com/x/me.jpg', missing: [],
}

function setup(profile) {
  api.get.mockImplementation((url) => Promise.resolve({ data: url === '/tutor/catalog' ? CATALOG : profile }))
  api.put.mockImplementation((url, body) => Promise.resolve({ data: { ...profile, ...body } }))
  api.post.mockResolvedValue({ data: { ...profile, status: 'UNDER_REVIEW' } })
  return render(<MemoryRouter><ProfileSetup /></MemoryRouter>)
}

beforeEach(() => vi.clearAllMocks())

describe('tutor profile setup', () => {
  test('Save and continue is blocked while a required field is missing, and nothing is saved', async () => {
    setup(NEW_TUTOR)
    await userEvent.click(await screen.findByRole('button', { name: 'Save and continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/emergency contact name|gender/i)
    expect(api.put).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Basic information' })).toBeInTheDocument()
  })

  test('a complete basic step is saved on its own and the wizard moves on', async () => {
    setup(NEW_TUTOR)
    await userEvent.click(await screen.findByRole('radio', { name: 'Male' }))
    await userEvent.type(screen.getByLabelText(/Emergency contact name/), 'Lisa Tan')
    await userEvent.type(screen.getByLabelText(/Emergency contact number/), '012-000 0000')
    await userEvent.selectOptions(screen.getByLabelText(/Home area/), 'Petaling Jaya, Selangor')
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }))
    expect(api.put).toHaveBeenCalledWith('/tutor/profile', {
      fullName: 'Daniel Tan', phone: '+60123456789', gender: 'MALE',
      emergencyContactName: 'Lisa Tan', emergencyContactPhone: '+60120000000', location: 'Petaling Jaya, Selangor',
    })
    expect(await screen.findByRole('heading', { name: 'Teaching information' })).toBeInTheDocument()
  })

  test('submit stays disabled until the confirmation box is ticked', async () => {
    setup(COMPLETE)
    await userEvent.click(await screen.findByRole('button', { name: /Review and submit/ }))
    const submit = screen.getByRole('button', { name: 'Submit for verification' })
    expect(submit).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: /I confirm the information is true/ }))
    expect(submit).toBeEnabled()
    await userEvent.click(submit)
    expect(api.post).toHaveBeenCalledWith('/tutor/submit-for-verification')
  })
})

describe('setup step checks (mirror the server)', () => {
  const form = { fullName: 'Daniel Tan', phone: '0123456789', gender: 'MALE', emergencyContactName: 'Lisa Tan', emergencyContactPhone: '0123456789', location: 'Kepong, Kuala Lumpur' }
  test('the emergency contact must be someone else', () => {
    expect(checkStep('basic', form, NEW_TUTOR)).toMatch(/different from your own number/)
  })
  test('documents need an identity document and a qualification that are not rejected', () => {
    expect(checkStep('documents', {}, { documents: [{ kind: 'QUALIFICATION', status: 'PENDING' }] })).toMatch(/NRIC or passport/)
    expect(checkStep('documents', {}, { documents: [{ kind: 'IDENTITY', status: 'REJECTED' }, { kind: 'QUALIFICATION', status: 'APPROVED' }] })).toMatch(/NRIC or passport/)
    expect(checkStep('documents', {}, COMPLETE)).toBe('')
  })
  test('the hourly rate follows the same RM rule as the server', () => {
    const teaching = { subjects: COMPLETE.subjects, hourlyRate: '60.555', yearsExperience: '4', offersPhysical: true, offersOnline: false, bio: COMPLETE.bio, teachingApproach: '' }
    expect(checkStep('teaching', teaching, COMPLETE)).toMatch(/2 decimal places/)
    expect(checkStep('teaching', { ...teaching, hourlyRate: '60' }, COMPLETE)).toBe('')
  })
})
