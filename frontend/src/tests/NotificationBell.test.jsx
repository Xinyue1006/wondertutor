import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import api from '../api/client'
import { NotificationBell } from '../layouts/AppLayout'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
const notification = { id: 7, title: 'Booking accepted', message: 'Your lesson is ready for payment.', isRead: false, createdAt: '2026-11-11T00:00:00Z' }
beforeEach(() => { vi.clearAllMocks() })
const open = () => {
  render(<MemoryRouter><NotificationBell /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
}

test('notification failures are not shown as an empty inbox and can be retried', async () => {
  api.get.mockRejectedValue(new Error('Offline'))
  open()
  expect(await screen.findByRole('alert')).toHaveTextContent("couldn't load notifications")
  expect(screen.queryByText("You're all caught up.")).not.toBeInTheDocument()
  api.get.mockResolvedValue({ data: { unread: 0, notifications: [] } })
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText("You're all caught up.")).toBeInTheDocument()
})

test('failed mark-all requests keep the unread notifications and report the failure', async () => {
  api.get.mockResolvedValue({ data: { unread: 1, notifications: [notification] } })
  api.post.mockRejectedValue(new Error('Offline'))
  open()
  await screen.findByText('Booking accepted')
  fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("couldn't mark notifications as read")
  expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument()
})
