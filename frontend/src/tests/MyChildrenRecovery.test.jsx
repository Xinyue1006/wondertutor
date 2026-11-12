import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import MyChildren from '../pages/parent/MyChildren'
import api from '../api/client'
vi.mock('../api/client', () => ({ default: { get: vi.fn(), put: vi.fn() }, errorMessage: () => 'Unable to refresh the child list' }))
vi.mock('../assistant/MatchingContext', () => ({ useMatching: () => ({ catalog: { subjects: ['Mathematics'], subjectLevels: { Mathematics: ['PRIMARY'] } }, refreshChildren: async () => {}, applyChild: () => {} }) }))
vi.mock('../components/PhotoPicker', () => ({ default: () => null }))

test('a pending save cannot be dismissed and refresh failures remain visible after saving', async () => {
  const child = { id: 1, name: 'QA Child', educationLevel: 'PRIMARY', grade: 4, subjects: ['Mathematics'], bookingCount: 0 }
  api.get.mockResolvedValueOnce({ data: { children: [child] } }).mockRejectedValueOnce(new Error('offline'))
  let finish
  api.put.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  render(<MemoryRouter><MyChildren /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit', exact: true }))
  fireEvent.change(screen.getByPlaceholderText('e.g. Sarah Tan'), { target: { value: 'QA Updated' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
  expect(screen.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await act(async () => { finish({ data: {} }) })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByText('Unable to refresh the child list')).toBeInTheDocument()
})
