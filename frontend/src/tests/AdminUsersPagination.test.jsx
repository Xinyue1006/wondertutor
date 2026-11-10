import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import AdminUsers from '../pages/admin/AdminUsers'
import api from '../api/client'

vi.mock('../api/client', () => ({ default: { get: vi.fn() }, errorMessage: String }))

test('paging retains the search and filters, and editing the search resets the page', async () => {
  api.get.mockImplementation(async (_url, { params }) => ({
    data: { users: [], threshold: 3, page: Number(params.page), pages: 3 },
  }))
  render(<MemoryRouter initialEntries={['/admin/users?q=Tan&role=TUTOR&status=ACTIVE&pending=1&review=1&flagged=1']}><AdminUsers /></MemoryRouter>)
  await screen.findByText('Page 1 of 3')
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByText('Page 2 of 3')
  const filters = { q: 'Tan', role: 'TUTOR', status: 'ACTIVE', pending: '1', review: '1', flagged: '1' }
  expect(api.get.mock.lastCall[1].params).toEqual({ ...filters, page: '2' })
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
  await screen.findByText('Page 1 of 3')
  expect(api.get.mock.lastCall[1].params).toEqual({ ...filters, page: '1' })
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByText('Page 2 of 3')
  fireEvent.change(screen.getByPlaceholderText('Search by name or email'), { target: { value: 'Adam' } })
  await screen.findByText('Page 1 of 3')
  expect(api.get.mock.lastCall[1].params).toEqual({ ...filters, q: 'Adam', page: '1' })
})
