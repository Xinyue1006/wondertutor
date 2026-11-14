import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'

let auth = { user: null }
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }))

import api from '../api/client'
import Home from '../pages/Home'

const tutor = {
  id: 7, name: 'Daniel Tan', photoUrl: null, rating: 4.9, reviewCount: 128, hourlyRate: 60,
  mainSubject: 'Mathematics', levels: 'Primary 5 – Secondary 3', location: 'Kepong, Kuala Lumpur',
}

const setup = (data) => {
  api.get.mockResolvedValue({ data })
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<div>LOGIN PAGE</div>} />
        <Route path="/tutors" element={<div>PUBLIC TUTORS</div>} />
        <Route path="/tutors/:id" element={<div>PUBLIC TUTOR PROFILE</div>} />
        <Route path="/signup" element={<div>SIGNUP PAGE</div>} />
        <Route path="/parent/find-tutor/match" element={<div>WIZARD</div>} />
      </Routes>
    </MemoryRouter>,
  )
}
const full = { tutors: [tutor], subjects: ['Mathematics', 'English'], locations: ['Kepong, Kuala Lumpur'] }

beforeEach(() => { auth = { user: null }; vi.clearAllMocks(); sessionStorage.clear() })

describe('landing page', () => {
  test('search works immediately while the tutor catalogue is still loading', async () => {
    api.get.mockReturnValue(new Promise(() => {}))
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
          <Route path="/tutors" element={<div>PUBLIC TUTORS</div>} />
        </Routes>
      </MemoryRouter>,
    )
    const subject = screen.getByRole('combobox', { name: /Subject/ })
    expect(subject).toBeEnabled()
    expect(subject).toBeVisible()
    await userEvent.type(subject, 'Mathematics')
    await userEvent.type(screen.getByRole('combobox', { name: /Education Level/ }), 'Primary')
    await userEvent.click(screen.getByRole('button', { name: /Search Tutors/ }))
    expect(await screen.findByText('PUBLIC TUTORS')).toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem('wt-home-search'))).toMatchObject({ subject: 'Mathematics', level: 'Primary' })
  })

  test('shows real tutors from the API and marks them as sample data', async () => {
    setup(full)
    expect(await screen.findByText('Daniel Tan')).toBeInTheDocument()
    expect(screen.getByText('RM 60 / hour')).toBeInTheDocument()
    expect(screen.getByText(/Sample tutor profiles/)).toBeInTheDocument()
  })

  test('shows an empty state instead of a blank gap when there are no tutors', async () => {
    setup({ ...full, tutors: [] })
    expect(await screen.findByText(/Tutor profiles will appear here soon/)).toBeInTheDocument()
  })

  test('search with a missing subject and level explains what is needed and stays on the page', async () => {
    setup(full)
    await screen.findByText('Daniel Tan')
    await userEvent.click(screen.getByRole('button', { name: /Search Tutors/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a subject and an education level.')
    expect(screen.queryByText('LOGIN PAGE')).not.toBeInTheDocument()
  })

  test('a value that is not in the list is rejected', async () => {
    setup(full)
    await screen.findByText('Daniel Tan')
    await userEvent.type(screen.getByRole('combobox', { name: /Subject/ }), 'Underwater basket weaving')
    await userEvent.type(screen.getByRole('combobox', { name: /Education Level/ }), 'Primary')
    await userEvent.click(screen.getByRole('button', { name: /Search Tutors/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick a subject from the list.')
  })

  test('typing narrows the suggestions and a valid guest search opens public browsing and is remembered', async () => {
    setup(full)
    await screen.findByText('Daniel Tan')
    await userEvent.type(screen.getByRole('combobox', { name: /Subject/ }), 'mat')
    await userEvent.click(await screen.findByRole('option', { name: 'Mathematics' }))
    await userEvent.type(screen.getByRole('combobox', { name: /Education Level/ }), 'Prim')
    await userEvent.click(await screen.findByRole('option', { name: 'Primary' }))
    expect(screen.getByText('Selected: Mathematics · Primary')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Search Tutors/ }))
    expect(await screen.findByText('PUBLIC TUTORS')).toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem('wt-home-search'))).toMatchObject({ subject: 'Mathematics', level: 'Primary' })
  })

  test('a parent goes straight to the matching wizard', async () => {
    auth = { user: { role: 'PARENT' } }
    setup(full)
    await screen.findByText('Daniel Tan')
    await userEvent.click(screen.getByRole('button', { name: /Try AI Matching/ }))
    expect(await screen.findByText('WIZARD')).toBeInTheDocument()
  })

  test('a guest can open a featured tutor profile without logging in', async () => {
    setup(full)
    await screen.findByText('Daniel Tan')
    await userEvent.click(screen.getByRole('button', { name: 'View profile of Daniel Tan' }))
    expect(await screen.findByText('PUBLIC TUTOR PROFILE')).toBeInTheDocument()
    expect(screen.queryByText('LOGIN PAGE')).not.toBeInTheDocument()
  })

  test('stored parent reviews link to public tutor profiles without a sample caption', async () => {
    setup({ ...full, reviews: [{ id: 31, parentName: 'Parent S.H.', rating: 5, comment: 'Patient explanations helped my child understand the exercises.', tutorId: 7, tutorName: 'Daniel Tan' }] })
    expect(await screen.findByRole('heading', { name: 'What Parents Say' })).toBeInTheDocument()
    expect(screen.getByText('Patient explanations helped my child understand the exercises.')).toBeInTheDocument()
    expect(screen.queryByText('Sample parent reviews for demonstration.')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: "View Daniel Tan's profile" })).toHaveAttribute('href', '/tutors/7')
  })

  test('the earlier search is restored when the visitor comes back', async () => {
    sessionStorage.setItem('wt-last-search', JSON.stringify({ subject: 'English', level: 'Secondary', location: '' }))
    setup(full)
    expect(await screen.findByDisplayValue('English')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Secondary')).toBeInTheDocument()
  })

  test('the location box suggests places from anywhere in Malaysia as you type, and a match goes on to the wizard', async () => {
    api.get.mockImplementation(async (url, opts) => (url === '/public/places'
      ? { data: { popular: false, results: opts?.params?.q ? [{ label: 'Kota Kinabalu, Sabah', kind: 'town', state: 'Sabah' }] : [{ label: 'Kepong, Kuala Lumpur', kind: 'area', state: 'Kuala Lumpur' }] } }
      : { data: full }))
    render(<MemoryRouter><Routes><Route path="/" element={<Home />} /><Route path="/login" element={<div>LOGIN PAGE</div>} /><Route path="/tutors" element={<div>PUBLIC TUTORS</div>} /></Routes></MemoryRouter>)
    await screen.findByText('Daniel Tan')
    await userEvent.type(screen.getByRole('combobox', { name: /Subject/ }), 'Mathematics')
    await userEvent.type(screen.getByRole('combobox', { name: /Education Level/ }), 'Primary')
    await userEvent.type(screen.getByRole('combobox', { name: /Location/ }), 'kota')
    await userEvent.click(await screen.findByRole('option', { name: 'Kota Kinabalu, Sabah' }))
    expect(screen.getByDisplayValue('Kota Kinabalu, Sabah')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Search Tutors/ }))
    expect(await screen.findByText('PUBLIC TUTORS')).toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem('wt-home-search'))).toMatchObject({ location: 'Kota Kinabalu, Sabah' })
  })

  test('the four How It Works steps are an ordered list', async () => {
    setup(full)
    const steps = await screen.findAllByRole('listitem')
    expect(steps.some((li) => li.textContent.includes('Tell Us Your Needs'))).toBe(true)
  })
})
