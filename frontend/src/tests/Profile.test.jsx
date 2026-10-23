import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

const setUser = vi.fn()
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, email: 'miki@example.com', fullName: 'Miki Lim', role: 'PARENT' }, setUser, logout: vi.fn() }) }))
vi.mock('../assistant/MatchingContext', () => ({
  useMatching: () => ({ catalog: { locations: ['Kepong, Kuala Lumpur', 'Banting, Selangor'], subjects: [] }, kids: [{ id: 1, name: 'Sarah' }], loadError: '', reloadShared: vi.fn() }),
}))
vi.mock('../api/client', () => ({
  default: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
  errorMessage: (e) => e?.response?.data?.message || e.message,
}))
// The Privacy tab is tested on its own; here it only has to appear
vi.mock('../components/PrivacyAccountCard', () => ({ default: () => <div>PRIVACY CARD</div> }))

import api from '../api/client'
import Profile from '../pages/parent/Profile'

const PROFILE = {
  fullName: 'Miki Lim', email: 'miki@example.com', phone: '+60123456789', profilePhotoUrl: null, address: 'Kepong, Kuala Lumpur',
  addressKnown: true, preferences: null, hasPassword: true, emailReminders: true, privacyAcceptedAt: '2026-10-01T00:00:00Z', memberSince: '2026-09-12T00:00:00Z',
}

function setup(profile = {}, url = '/parent/profile') {
  api.get.mockImplementation(async (path) => (path === '/public/places'
    ? { data: { popular: false, results: [{ label: PROFILE.address, kind: 'area', state: 'Kuala Lumpur' }] } }
    : { data: { profile: { ...PROFILE, ...profile } } }))
  api.put.mockImplementation(async (path, body) => ({ data: { profile: { ...PROFILE, ...profile, ...body } } }))
  return render(<MemoryRouter initialEntries={[url]}><Profile /></MemoryRouter>)
}

beforeEach(() => vi.clearAllMocks())

describe('My Profile layout', () => {
  test('has four sections as tabs, and opens on the personal details', async () => {
    setup()
    expect(await screen.findByRole('heading', { name: 'Personal details' })).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((t) => t.textContent.trim())).toEqual(['Personal details', 'Tutor preferences', 'Password & email', 'Privacy & account'])
    expect(screen.getByRole('tab', { name: 'Personal details' })).toHaveAttribute('aria-selected', 'true')
  })

  test('the summary shows the name, email, member-since date and what is left to complete', async () => {
    setup()
    await screen.findByRole('heading', { name: 'Personal details' })
    const summary = screen.getByRole('region', { name: 'Profile summary' })
    expect(summary).toHaveTextContent('Miki Lim')
    expect(summary).toHaveTextContent('miki@example.com')
    expect(summary).toHaveTextContent('Member since September 2026')
    // phone, area and a child are done; the preferences are not
    expect(screen.getByRole('progressbar', { name: 'Profile completeness' })).toHaveAttribute('aria-valuenow', '3')
    expect(summary).toHaveTextContent('Set your tutor preferences')
  })

  test('switching tabs shows each section, and the tab can be opened from the address', async () => {
    setup()
    await screen.findByRole('heading', { name: 'Personal details' })
    await userEvent.click(screen.getByRole('tab', { name: 'Password & email' }))
    expect(screen.getByRole('heading', { name: 'Password' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Privacy & account' }))
    expect(screen.getByText('PRIVACY CARD')).toBeInTheDocument()
  })

  test('opens straight on the privacy tab from a link', async () => {
    setup({}, '/parent/profile?tab=privacy')
    expect(await screen.findByText('PRIVACY CARD')).toBeInTheDocument()
  })

  test('arrow keys move between the tabs', async () => {
    setup()
    await screen.findByRole('heading', { name: 'Personal details' })
    screen.getByRole('tab', { name: 'Personal details' }).focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(await screen.findByRole('heading', { name: 'Tutor preferences' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Tutor preferences' })).toHaveFocus()
  })
})

describe('personal details', () => {
  test('Save is off until something changes, and says there are unsaved changes', async () => {
    setup()
    const save = await screen.findByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Full name'), ' Jr')
    expect(save).toBeEnabled()
    expect(screen.getByText('You have unsaved changes.')).toBeInTheDocument()
  })

  test('shows the saved phone with its country, and sends the number with the chosen country code', async () => {
    setup()
    await screen.findByRole('button', { name: 'Save changes' })
    expect(screen.getByLabelText('Country code')).toHaveValue('MY')
    expect(screen.getByLabelText('Phone number')).toHaveValue('123456789')
    await userEvent.selectOptions(screen.getByLabelText('Country code'), 'SG')
    const number = screen.getByLabelText('Phone number')
    await userEvent.clear(number)
    await userEvent.type(number, '9123 4567')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.put).toHaveBeenCalled())
    expect(api.put).toHaveBeenCalledWith('/parent/profile', { fullName: 'Miki Lim', phone: '+6591234567', address: 'Kepong, Kuala Lumpur' })
    expect(await screen.findByText('Your details were saved.')).toBeInTheDocument()
    expect(setUser).toHaveBeenCalled()
  })

  test('each problem is shown next to its own field and nothing is sent', async () => {
    setup()
    await screen.findByRole('button', { name: 'Save changes' })
    await userEvent.clear(screen.getByLabelText('Full name'))
    const number = screen.getByLabelText('Phone number')
    await userEvent.clear(number)
    await userEvent.type(number, '12')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Enter the full name.')).toBeInTheDocument()
    expect(screen.getByText(/Enter a valid Malaysian phone number/)).toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toHaveFocus() // the first problem
    expect(api.put).not.toHaveBeenCalled()
  })

  test('the email cannot be edited', async () => {
    setup()
    expect(await screen.findByLabelText('Email address')).toBeDisabled()
  })
})

describe('password', () => {
  test('a new password must match, and shows the strength', async () => {
    setup()
    await screen.findByRole('heading', { name: 'Personal details' })
    await userEvent.click(screen.getByRole('tab', { name: 'Password & email' }))
    await userEvent.type(screen.getByLabelText('Current password'), 'Parent1234')
    await userEvent.type(screen.getByLabelText('New password'), 'Newpass5678')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'Different1')
    expect(screen.getByText('The passwords do not match')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match')
    expect(api.post).not.toHaveBeenCalled()
  })

  test('a Google account is told it has no password', async () => {
    setup({ hasPassword: false })
    await screen.findByRole('heading', { name: 'Personal details' })
    await userEvent.click(screen.getByRole('tab', { name: 'Password & email' }))
    expect(screen.getByText(/no password to change/)).toBeInTheDocument()
  })
})
