import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ saveSession: vi.fn(), googleLogin: vi.fn(), user: null, loading: false }) }))
vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  errorMessage: (e) => e?.response?.data?.message || e.message,
}))

import api from '../api/client'
import Signup from '../pages/auth/Signup'

const setup = () => {
  sessionStorage.clear()
  api.get.mockResolvedValue({ data: { subjects: ['Mathematics', 'English'], locations: [], tutors: [] } })
  api.post.mockResolvedValue({ data: { message: 'ok' } })
  return render(<MemoryRouter><Signup /></MemoryRouter>)
}

const choose = async (name) => userEvent.click(screen.getByRole('radio', { name: new RegExp(name) }))
const next = async () => userEvent.click(screen.getByRole('button', { name: /^(Next|Create Account)/ }))
const menu = () => screen.getByRole('complementary')

async function fillBasic() {
  await userEvent.type(screen.getByLabelText(/Full Name/), 'Miki Lim')
  await userEvent.type(screen.getByLabelText(/Email Address/), 'miki@example.com')
  await userEvent.type(screen.getByLabelText(/Create Password/), 'Parent1234')
  await userEvent.type(screen.getByLabelText(/Confirm Password/), 'Parent1234')
}

beforeEach(() => vi.clearAllMocks())

describe('signup: parent sections', () => {
  test('a parent gets Basic, Contact, My Children and Preferences; the last two are marked optional', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /^Next/ }))
    const m = within(menu())
    for (const label of ['Basic Information', 'Contact Details', 'My Children', 'Preferences']) expect(m.getByRole('button', { name: new RegExp(label) })).toBeEnabled()
    expect(m.getAllByText('Optional')).toHaveLength(2)
  })

  test('the password is asked for in Basic Information and the phone number in Contact Details', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /^Next/ }))
    expect(screen.getByLabelText(/Create Password/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Phone Number/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/Full Name/), 'Miki Lim')
    await userEvent.type(screen.getByLabelText(/Email Address/), 'miki@example.com')
    await next()
    expect(await screen.findByRole('alert')).toHaveTextContent(/Password must be at least 8 characters/)
  })

  test('every child needs a level and a subject', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /^Next/ }))
    await fillBasic()
    await next()
    await userEvent.type(screen.getByLabelText(/Phone Number/), '123456789')
    await next()
    await userEvent.click(screen.getByRole('button', { name: /Add a child/ }))
    await userEvent.type(screen.getByLabelText(/Child's Name/), 'Sarah')
    await userEvent.selectOptions(screen.getByLabelText(/Education Level/), 'PRIMARY:5')
    await next()
    expect(await screen.findByRole('alert')).toHaveTextContent(/subject each child needs/)
  })

  test('sends the children (with subject and goals) and the chosen preferences, then asks for the email code', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /^Next/ }))
    await fillBasic()
    await next()
    await userEvent.type(screen.getByLabelText(/Phone Number/), '123456789')
    await next()
    await userEvent.click(screen.getByRole('button', { name: /Add a child/ }))
    await userEvent.type(screen.getByLabelText(/Child's Name/), 'Sarah')
    await userEvent.selectOptions(screen.getByLabelText(/Education Level/), 'PRIMARY:5')
    await userEvent.selectOptions(screen.getByLabelText(/Subject needed/), 'Mathematics')
    await userEvent.type(screen.getByLabelText(/Learning needs or goals/), 'Faster at word problems')
    await next()
    // Preferences: Physical, Evening, Saturday, Structured, up to RM 60
    await userEvent.click(screen.getByRole('radio', { name: 'Physical' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Evening' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Sat' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Structured' }))
    await userEvent.selectOptions(screen.getByLabelText(/Maximum budget per hour/), '60')
    await next()

    const [url, body] = api.post.mock.calls.find(([u]) => u === '/auth/register')
    expect(url).toBe('/auth/register')
    expect(body).toMatchObject({
      role: 'PARENT', fullName: 'Miki Lim', email: 'miki@example.com', phone: '+60123456789',
      children: [{ name: 'Sarah', educationLevel: 'PRIMARY', grade: 5, subject: 'Mathematics', notes: 'Faster at word problems' }],
      preferences: { mode: 'PHYSICAL', gender: 'ANY', characteristics: ['Structured'], days: [6], timePreset: 'EVENING', budgetMax: 60 },
    })
    expect(await screen.findByText('Verify your email')).toBeInTheDocument()
  })

  test('preferences are left out of the request when none are chosen', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /^Next/ }))
    await fillBasic()
    await next()
    await userEvent.type(screen.getByLabelText(/Phone Number/), '123456789')
    await next()
    await next() // children are optional
    await next() // preferences are optional: Create Account
    const [, body] = api.post.mock.calls.find(([u]) => u === '/auth/register')
    expect(body.preferences).toBeUndefined()
    expect(body.children).toEqual([])
  })

  test('progress is remembered for the session but the password never is', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /^Next/ }))
    await fillBasic()
    const draft = sessionStorage.getItem('wt-signup-draft')
    expect(draft).toContain('miki@example.com')
    expect(draft).not.toContain('Parent1234')
  })
})

describe('signup: tutor', () => {
  test('a tutor sees the remaining profile sections locked (they are completed in the Tutor Portal)', async () => {
    setup()
    await choose("I'm a Tutor")
    await userEvent.click(screen.getByRole('button', { name: /^Next/ }))
    const m = within(menu())
    for (const label of ['Teaching Information', 'Availability', 'Qualifications', 'Review & Submit']) expect(m.getByRole('button', { name: new RegExp(label) })).toBeDisabled()
    expect(m.queryByRole('button', { name: /Preferences/ })).not.toBeInTheDocument()
  })
})
