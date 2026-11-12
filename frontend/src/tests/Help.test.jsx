import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import Help from '../pages/Help'
import api from '../api/client'
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'PARENT' } }) }))
vi.mock('../api/client', () => ({ default: { get: vi.fn() }, errorMessage: () => 'Help is temporarily unavailable' }))
test('FAQ search, empty results, clear and disclosure work without AI', async () => {
  api.get.mockResolvedValue({ data: { entries: [{ id: 'refund', topic: 'Refunds', answer: 'An admin reviews refund requests.' }, { id: 'trial', topic: 'Trial lessons', answer: 'No trial lessons are offered.' }] } })
  render(<MemoryRouter><Help /></MemoryRouter>)
  await screen.findByText('2 answers found')
  fireEvent.change(screen.getByLabelText('Search FAQs'), { target: { value: 'refund' } })
  expect(screen.getByText('1 answer found')).toBeInTheDocument()
  expect(screen.queryByText('Trial lessons')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Search FAQs'), { target: { value: 'nothing matches' } })
  expect(screen.getByText(/No matching answers/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(screen.getByText('2 answers found')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Report an issue' })).toHaveAttribute('href', '/parent/complaints')
})
