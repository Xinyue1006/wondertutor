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
    await userEvent.click(screen.getByRole('button', { name: /^Continue as/ }))
    const m = within(menu())
    for (const label of ['Basic Information', 'Contact Details', 'My Children', 'Preferences']) expect(m.getByRole('button', { name: new RegExp(label) })).toBeEnabled()
    expect(m.getAllByText('Optional')).toHaveLength(2)
  })

  test('the password is asked for in Basic Information and the phone number in Contact Details', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /^Continue as/ }))
    expect(screen.getByLabelText(/Create Password/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Phone Number/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/Full Name/), 'Miki Lim')
    await userEvent.type(screen.getByLabelText(/Email Address/), 'miki@example.com')
    await next()
    expect(await screen.findByRole('alert')).toHaveTextContent(/Password must be at least 8 characters/)
  })

  test('every child needs a level and a subject', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /^Continue as/ }))
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
    await userEvent.click(screen.getByRole('button', { name: /^Continue as/ }))
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
    expect(await screen.findByText('Check your email')).toBeInTheDocument()
  })

  test('preferences are left out of the request when none are chosen', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /^Continue as/ }))
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
    await userEvent.click(screen.getByRole('button', { name: /^Continue as/ }))
    await fillBasic()
    const draft = sessionStorage.getItem('wt-signup-draft')
    expect(draft).toContain('miki@example.com')
    expect(draft).not.toContain('Parent1234')
  })
})

describe('signup: tutor', () => {
  const openTutorForm = async () => {
    setup()
    await choose("I'm a Tutor")
    await userEvent.click(screen.getByRole('button', { name: /^Continue as Tutor/ }))
  }
  const fillTutor = async () => {
    await userEvent.type(screen.getByLabelText(/Full name/), 'Daniel Tan')
    await userEvent.type(screen.getByLabelText(/Email address/), 'daniel@example.com')
    await userEvent.type(screen.getByLabelText(/Phone number/), '0123456789')
    await userEvent.type(screen.getByLabelText(/^Password/), 'Tutor1234')
    await userEvent.type(screen.getByLabelText(/Confirm password/), 'Tutor1234')
  }
  const create = () => userEvent.click(screen.getByRole('button', { name: 'Create account and send code' }))

  test('the tutor form asks only for the account details: no parent sections, gender or emergency contact', async () => {
    await openTutorForm()
    expect(screen.getByLabelText(/Phone number/)).toBeInTheDocument()
    expect(screen.queryByText('My Children')).not.toBeInTheDocument()
    expect(screen.queryByText('Preferences')).not.toBeInTheDocument()
    expect(screen.queryByText(/Emergency/)).not.toBeInTheDocument()
    expect(screen.queryByText('Gender')).not.toBeInTheDocument()
    expect(screen.getByText('Complete profile')).toBeInTheDocument() // the 4th step only tutors have
  })

  test('the terms must be accepted before the account is created', async () => {
    await openTutorForm()
    await fillTutor()
    await create()
    expect(await screen.findByRole('alert')).toHaveTextContent(/Terms of Use/)
    expect(api.post.mock.calls.find(([u]) => u === '/auth/register')).toBeUndefined()
  })

  test('sends only the account fields, then shows the code step with the real code rules', async () => {
    await openTutorForm()
    await fillTutor()
    await userEvent.click(screen.getByRole('checkbox', { name: /Terms of Use/ }))
    await create()
    const [, body] = api.post.mock.calls.find(([u]) => u === '/auth/register')
    expect(body).toEqual({ role: 'TUTOR', fullName: 'Daniel Tan', email: 'daniel@example.com', phone: '+60123456789', password: 'Tutor1234' })
    expect(await screen.findByText('Check your email')).toBeInTheDocument()
    expect(screen.getByText(/works for 10 minutes/)).toBeInTheDocument()
    expect(screen.getByText(/After 5 wrong tries/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '6-digit verification code' })).toBeInTheDocument()
  })

  test('the code boxes move forward while typing and accept a pasted code', async () => {
    await openTutorForm()
    await fillTutor()
    await userEvent.click(screen.getByRole('checkbox', { name: /Terms of Use/ }))
    await create()
    await screen.findByText('Check your email')
    await userEvent.type(screen.getByLabelText('Digit 1 of 6'), '12')
    expect(screen.getByLabelText('Digit 2 of 6')).toHaveValue('2')
    expect(screen.getByLabelText('Digit 3 of 6')).toHaveFocus()
    await userEvent.click(screen.getByLabelText('Digit 1 of 6'))
    await userEvent.paste('654321')
    expect(screen.getByLabelText('Digit 6 of 6')).toHaveValue('1')
    expect(screen.getByRole('button', { name: 'Verify and continue' })).toBeEnabled()
  })
})
