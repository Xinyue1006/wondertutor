import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

vi.mock('../api/client', () => ({ default: { get: vi.fn() }, errorMessage: (e) => e.message }))
import api from '../api/client'
import RescheduleModal from '../components/RescheduleModal'

const booking = { id: 5, tutor: { id: 2, name: 'Ms. Lee' }, startAt: '2026-10-19T08:00:00.000Z', endAt: '2026-10-19T09:00:00.000Z' }
const days = [
  { date: '2026-10-20', dow: 2, slots: [{ start: '16:00', end: '17:00', status: 'unavailable' }, { start: '17:00', end: '18:00', status: 'available' }] },
  { date: '2026-10-21', dow: 3, slots: [{ start: '16:00', end: '17:00', status: 'unavailable' }] },
]

describe('reschedule dialog', () => {
  test('offers only the tutor free times and sends the chosen one with the reason', async () => {
    api.get.mockResolvedValue({ data: { days } })
    const onSubmit = vi.fn().mockResolvedValue(null)
    render(<RescheduleModal booking={booking} onClose={() => {}} onSubmit={onSubmit} />)
    expect(await screen.findByRole('button', { name: '5:00 PM' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '4:00 PM' })).not.toBeInTheDocument() // taken
    expect(screen.getByRole('button', { name: 'Send Request' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '5:00 PM' }))
    await userEvent.type(screen.getByLabelText(/Reason for the tutor/), 'School event')
    await userEvent.click(screen.getByRole('button', { name: 'Send Request' }))
    expect(onSubmit).toHaveBeenCalledWith({ date: '2026-10-20', startTime: '17:00', reason: 'School event' })
  })

  test('shows the server problem inside the dialog', async () => {
    api.get.mockResolvedValue({ data: { days } })
    render(<RescheduleModal booking={booking} onClose={() => {}} onSubmit={async () => 'That time slot has just been taken.'} />)
    await userEvent.click(await screen.findByRole('button', { name: '5:00 PM' }))
    await userEvent.click(screen.getByRole('button', { name: 'Send Request' }))
    expect(await screen.findByText('That time slot has just been taken.')).toBeInTheDocument()
  })

  test('says so when the tutor has no free time that week', async () => {
    api.get.mockResolvedValue({ data: { days: [days[1]] } })
    render(<RescheduleModal booking={booking} onClose={() => {}} onSubmit={vi.fn()} />)
    expect(await screen.findByText(/No free times this week/)).toBeInTheDocument()
  })
})
