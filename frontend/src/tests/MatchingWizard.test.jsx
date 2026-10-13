import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'PARENT', fullName: 'Tan Xin Yue' } }) }))
vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  errorMessage: (e) => e?.response?.data?.message || e.message,
}))

import api from '../api/client'
import { MatchingProvider } from '../assistant/MatchingContext'
import MatchingWizard from '../pages/parent/MatchingWizard'

const catalog = {
  subjects: ['Mathematics', 'English'],
  locations: ['Kepong, Kuala Lumpur', 'Banting, Selangor'],
  characteristics: ['Structured'],
  homeLocation: 'Kepong, Kuala Lumpur',
}
const sarah = { id: 1, name: 'Sarah Tan', educationLevel: 'PRIMARY', grade: 5, subject: 'Mathematics' }

function setup({ kids = [] } = {}) {
  api.get.mockImplementation((url) => Promise.resolve({ data: url.includes('catalog') ? catalog : { children: kids } }))
  api.post.mockResolvedValue({ data: { id: 1, total: 0, tutors: [], criteria: {} } })
  return render(
    <MemoryRouter initialEntries={['/parent/find-tutor/match']}>
      <MatchingProvider>
        <Routes>
          <Route path="/parent/find-tutor/match" element={<MatchingWizard />} />
          <Route path="/parent/find-tutor/results" element={<div>RESULTS PAGE</div>} />
        </Routes>
      </MatchingProvider>
    </MemoryRouter>,
  )
}

// The first two dropdowns on Step 1 are Subject and Education Level
const dropdown = (i) => screen.getAllByRole('combobox')[i]

describe('3-step matching wizard', () => {
  beforeEach(() => vi.clearAllMocks())

  test('starts on Step 1 (Learning Needs)', async () => {
    setup()
    expect(await screen.findByText('Learning Needs', { selector: 'h2' })).toBeInTheDocument()
    expect(screen.getByText(/Step 1 of 3/)).toBeInTheDocument()
  })

  test('cannot continue without a subject and level', async () => {
    setup()
    await screen.findByText('Learning Needs', { selector: 'h2' })
    await userEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(screen.getByText(/required to find eligible tutors/i)).toBeInTheDocument()
    expect(screen.getByText(/Step 1 of 3/)).toBeInTheDocument()
  })

  test('a child pre-fills the subject and level', async () => {
    setup({ kids: [sarah] })
    await screen.findByText('Sarah Tan · Primary 5')
    await waitFor(() => expect(dropdown(0)).toHaveValue('Mathematics'))
    expect(dropdown(1)).toHaveValue('PRIMARY:5')
  })

  test('walks through all three steps and sends the criteria to the matching API', async () => {
    setup({ kids: [sarah] })
    await waitFor(() => expect(dropdown(0)).toHaveValue('Mathematics'))
    await userEvent.click(screen.getByRole('button', { name: /Next/ }))

    // Step 2: days, evening, physical
    expect(await screen.findByText(/Step 2 of 3/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Mon' }))
    await userEvent.click(screen.getByRole('button', { name: 'Fri' }))
    await userEvent.click(screen.getByRole('button', { name: 'Evening' }))
    await userEvent.click(screen.getByRole('button', { name: 'Physical' }))
    await userEvent.click(screen.getByRole('button', { name: /Next/ }))

    // Step 3: teaching style, then find
    expect(await screen.findByText(/Step 3 of 3/)).toBeInTheDocument()
    expect(screen.getByText('Any')).toBeInTheDocument() // budget untouched = no preference
    await userEvent.click(screen.getByRole('button', { name: 'Structured' }))
    await userEvent.click(screen.getByRole('button', { name: /Find My Matches/ }))

    expect(await screen.findByText('RESULTS PAGE')).toBeInTheDocument()
    const [url, body] = api.post.mock.calls[0]
    expect(url).toBe('/parent/matching')
    expect(body.source).toBe('WIZARD')
    expect(body.criteria).toMatchObject({
      subject: 'Mathematics', level: 'PRIMARY', grade: 5, days: [1, 5], mode: 'PHYSICAL',
      timeStart: '18:00', timeEnd: '20:00', characteristics: ['Structured'], budgetMax: null, childId: 1,
    })
  })

  test('Back keeps the answers already given', async () => {
    setup({ kids: [sarah] })
    await waitFor(() => expect(dropdown(0)).toHaveValue('Mathematics'))
    await userEvent.click(screen.getByRole('button', { name: /Next/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Tue' }))
    await userEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(await screen.findByText(/Step 1 of 3/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(screen.getByRole('button', { name: 'Tue' }).className).toMatch(/chip-on/)
  })

  test('shows the server message when the search fails', async () => {
    setup({ kids: [sarah] })
    api.post.mockImplementation(async () => { throw Object.assign(new Error('Request failed'), { response: { data: { message: 'Subject is required' } } }) })
    await waitFor(() => expect(dropdown(0)).toHaveValue('Mathematics'))
    await userEvent.click(screen.getByRole('button', { name: /Next/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Next/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Find My Matches/ }))
    expect(await screen.findByText('Subject is required')).toBeInTheDocument()
  })
})
