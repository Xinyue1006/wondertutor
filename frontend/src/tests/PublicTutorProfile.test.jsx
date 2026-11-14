import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { vi } from 'vitest'

let auth = { user: null }
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../assistant/MatchingContext', () => ({ useMatching: () => null }))
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() }, errorMessage: () => 'Tutor not found.' }))
import api from '../api/client'
import TutorProfile from '../pages/parent/TutorProfile'

const tutor = {
  id: 7, name: 'Daniel Tan', photoUrl: null, verified: true, rating: 4.9, reviewCount: 1, hourlyRate: 60,
  subjects: ['Mathematics'], levels: 'Primary 1–6', location: 'Kepong, Kuala Lumpur', offersOnline: true, offersPhysical: true,
  experienceText: { headline: '5+ years of tutoring experience', detail: 'Primary students', period: '(2021–Present)' },
  characteristics: ['Patient'], bio: 'An experienced and patient Mathematics tutor.', teachingApproach: ['Step-by-step guidance'], qualifications: [{ id: 1, title: 'BSc Mathematics', institution: 'University', status: 'APPROVED' }], achievements: [], grades: ['Primary 5'],
  upcomingAvailability: [{ date: '2026-11-21', slots: [{ start: '09:00', end: '10:00', status: 'available' }] }], ratingDistribution: [{ stars: 5, count: 1 }],
}
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}{JSON.stringify(location.state)}</output> }
function setup(initial = '/tutors/7') {
  return render(<MemoryRouter initialEntries={[initial]}><Location /><Routes><Route path="/tutors/:id" element={<TutorProfile publicView />} /><Route path="/login" element={<div>LOG IN</div>} /><Route path="/signup" element={<div>SIGN UP</div>} /><Route path="/parent/tutors/:id/book" element={<div>PRIVATE BOOKING</div>} /></Routes></MemoryRouter>)
}
beforeEach(() => {
  auth = { user: null }
  vi.clearAllMocks()
  api.get.mockImplementation(async url => url.endsWith('/reviews') ? { data: { reviews: [{ id: 1, parentName: 'Parent S. H.', parentOf: 'Private child detail', photoUrl: 'https://example.test/private-child.jpg', rating: 5, comment: 'Patient and clear explanations.', createdAt: '2026-11-01T00:00:00Z' }], hasMore: false } } : { data: { tutor } })
})

test('anonymous visitors read a profile and reviews without MatchingProvider or private API calls', async () => {
  setup()
  expect(await screen.findByRole('heading', { name: 'Daniel Tan', level: 1 })).toBeVisible()
  expect(await screen.findByText('Patient and clear explanations.')).toBeVisible()
  expect(screen.getByText(/^BSc Mathematics/)).toBeInTheDocument()
  expect(screen.getByText('Parent S. H.')).toBeVisible()
  expect(screen.queryByText(/Private child detail/)).not.toBeInTheDocument()
  expect(screen.queryByRole('img', { name: /Photo shared by/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Report this review' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save Daniel Tan' })).not.toBeInTheDocument()
  expect(screen.queryByText('Child')).not.toBeInTheDocument()
  expect(api.get.mock.calls.every(([url]) => url.startsWith('/public/tutors/'))).toBe(true)
  expect(api.post).not.toHaveBeenCalled()
})

test.each([['Log In to Book', '/login', 'LOG IN'], ['Create a Parent Account', '/signup', 'SIGN UP']])('%s carries the tutor into authentication', async (label, path, destination) => {
  setup()
  await screen.findByRole('heading', { name: 'Daniel Tan', level: 1 })
  await userEvent.click(screen.getByRole('link', { name: label }))
  expect(screen.getByText(destination)).toBeInTheDocument()
  expect(screen.getByTestId('location')).toHaveTextContent(path)
  expect(screen.getByTestId('location')).toHaveTextContent('"from":"/parent/tutors/7/book"')
})

test.each(['Log In to Book', 'Create a Parent Account'])('%s preserves Online from an alternative profile', async label => {
  setup('/tutors/7?mode=ONLINE')
  await screen.findByRole('heading', { name: 'Daniel Tan', level: 1 })
  await userEvent.click(screen.getByRole('link', { name: label }))
  expect(screen.getByTestId('location')).toHaveTextContent('"from":"/parent/tutors/7/book?mode=ONLINE"')
})

test('a signed-in parent continues directly to the existing private booking page', async () => {
  auth = { user: { id: 3, role: 'PARENT' } }
  setup()
  await screen.findByRole('heading', { name: 'Daniel Tan', level: 1 })
  await userEvent.click(screen.getByRole('link', { name: 'Continue to Booking' }))
  expect(screen.getByText('PRIVATE BOOKING')).toBeInTheDocument()
})

test('a missing tutor shows a public recovery link rather than a login redirect', async () => {
  api.get.mockRejectedValue(new Error('not found'))
  setup()
  await waitFor(() => expect(screen.getByText('Tutor not found.')).toBeVisible())
  expect(screen.getByRole('link', { name: 'Back to Find Tutors' })).toHaveAttribute('href', '/tutors')
})
