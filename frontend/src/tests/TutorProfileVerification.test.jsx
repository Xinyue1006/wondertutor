import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import api from '../api/client'
import ProfilePreview from '../pages/tutor/ProfilePreview'

vi.mock('../api/client', () => ({ default: { get: vi.fn() }, errorMessage: e => e.message }))
const profile = { fullName: 'Example Tutor', status: 'UNDER_REVIEW', submittedAt: '2026-11-01', isVerified: false, isEmailVerified: true,
  subjects: [], portfolio: [], yearsExperience: 1, documents: [
    { id: 1, kind: 'QUALIFICATION', title: 'Maths degree', status: 'APPROVED' },
    { id: 2, kind: 'IDENTITY', title: 'Passport', status: 'PENDING' },
  ] }
function show(data, ownProfile = true) {
  api.get.mockResolvedValue({ data })
  render(<MemoryRouter><ProfilePreview ownProfile={ownProfile} /></MemoryRouter>)
}
beforeEach(() => vi.spyOn(window, 'scrollTo').mockImplementation(() => {}))
afterEach(() => vi.restoreAllMocks())

test.each([
  [profile, 'Verified', 'Approved', 'Not awarded'],
  [{ ...profile, isEmailVerified: false, status: 'NOT_SUBMITTED', submittedAt: null, documents: [] }, 'Unverified', 'None uploaded', 'Not awarded'],
  [{ ...profile, status: 'VERIFIED', isVerified: true, documents: profile.documents.map(d => ({ ...d, status: 'APPROVED' })) }, 'Verified', 'Approved', 'Awarded'],
])('My Profile shows account, qualification and badge states independently', async (data, email, qualification, badge) => {
  show(data)
  const card = within(await screen.findByRole('region', { name: 'Verification' }))
  for (const [label, expected] of [['Email address', email], ['Qualification', qualification], ['Verified tutor badge', badge]]) {
    expect(card.getByText(label, { selector: 'dt' }).nextElementSibling).toHaveTextContent(expected)
  }
  if (!data.isVerified) expect(card.getByText(/can accept booking requests before/)).toBeVisible()
  if (data === profile) expect(card.getByText('Identity document:').parentElement).toHaveTextContent('Awaiting admin review')
})

test('the parent-facing preview keeps the private verification summary off the page', async () => {
  show(profile, false)
  await screen.findByText('Maths degree')
  expect(screen.queryByRole('region', { name: 'Verification' })).toBeNull()
})
