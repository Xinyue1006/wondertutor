import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import api from '../api/client'
import ChildProgress from '../pages/parent/ChildProgress'

vi.mock('../api/client', () => ({ default: { get: vi.fn() }, errorMessage: (err) => err.message }))
function NavigateChild() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/parent/children/2/progress')}>Another child</button>
}
const progress = {
  child: { id: 1, name: 'First Child', educationLevel: 'PRIMARY', grade: 1 },
  stats: { completedLessons: 0, totalHours: 0, summariesReceived: 0, physicalLessons: 0, checkedInLessons: 0 },
  subjects: [], nextLesson: null, timeline: [],
}

test('switching child routes never displays the previous child when the new request fails', async () => {
  let reject
  api.get.mockResolvedValueOnce({ data: progress }).mockImplementationOnce(() => new Promise((_resolve, failed) => { reject = failed }))
  render(<MemoryRouter initialEntries={['/parent/children/1/progress']}><NavigateChild /><Routes>
    <Route path="/parent/children/:id/progress" element={<ChildProgress />} />
  </Routes></MemoryRouter>)
  await screen.findByRole('heading', { name: "First Child's Learning Progress" })
  fireEvent.click(screen.getByRole('button', { name: 'Another child' }))
  expect(screen.queryByRole('heading', { name: "First Child's Learning Progress" })).not.toBeInTheDocument()
  await act(async () => reject(new Error('This child is not available')))
  expect(await screen.findByText('This child is not available')).toBeInTheDocument()
  expect(screen.queryByText("First Child's Learning Progress")).not.toBeInTheDocument()
})
