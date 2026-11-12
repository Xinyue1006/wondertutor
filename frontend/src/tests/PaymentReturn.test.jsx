import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import PaymentReturn from '../pages/parent/PaymentReturn'
import api from '../api/client'

vi.mock('../api/client', () => ({ default: { post: vi.fn() }, errorMessage: (e) => e.message }))

test.each(['REFUNDED', 'PARTIALLY_REFUNDED'])('an old %s bill shows a refund record rather than a failed payment', async (outcome) => {
  api.post.mockResolvedValue({ data: { outcome, message: 'This payment is recorded as refunded in WonderTutor.' } })
  render(<MemoryRouter initialEntries={['/parent/payments/return?billplz[id]=old-bill&billplz[x_signature]=signed']}><PaymentReturn /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Refund recorded' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Payment not completed' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Go to Payments' })).toBeInTheDocument()
})

test('a received payment for a cancelled lesson does not show booking confirmed', async () => {
  api.post.mockResolvedValue({ data: { outcome: 'RECORDED', message: 'Payment was received, but the booking is no longer confirmed.' } })
  render(<MemoryRouter initialEntries={['/parent/payments/return?billplz[id]=old-bill&billplz[x_signature]=signed']}><PaymentReturn /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Payment recorded' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Payment successful' })).not.toBeInTheDocument()
})
