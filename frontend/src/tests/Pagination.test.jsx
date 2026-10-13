import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import Pagination, { pageList } from '../components/ui/Pagination'
import { resultsHeading } from '../pages/parent/FindTutor'

describe('result counts', () => {
  test('says what is on screen out of the total', () => {
    expect(resultsHeading(null)).toBe('Searching…')
    expect(resultsHeading({ total: 0, page: 1, pageSize: 9, tutors: [] })).toBe('No tutors found')
    expect(resultsHeading({ total: 1, page: 1, pageSize: 9, tutors: [{}] })).toBe('Showing 1 tutor')
    expect(resultsHeading({ total: 7, page: 1, pageSize: 9, tutors: Array(7).fill({}) })).toBe('Showing all 7 tutors')
    expect(resultsHeading({ total: 11, page: 1, pageSize: 9, tutors: Array(9).fill({}) })).toBe('Showing 1–9 of 11 tutors')
    expect(resultsHeading({ total: 11, page: 2, pageSize: 9, tutors: Array(2).fill({}) })).toBe('Showing 10–11 of 11 tutors')
  })
})

describe('pagination', () => {
  test('page numbers keep the first, last and neighbours, with gaps', () => {
    expect(pageList(1, 1)).toEqual([1])
    expect(pageList(1, 3)).toEqual([1, 2, 3])
    expect(pageList(6, 12)).toEqual([1, '…', 5, 6, 7, '…', 12])
    expect(pageList(12, 12)).toEqual([1, '…', 11, 12])
  })

  test('is hidden when there is only one page', () => {
    const { container } = render(<Pagination page={1} totalPages={1} onChange={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  test('marks the current page and moves with previous / next / numbers', async () => {
    const onChange = vi.fn()
    render(<Pagination page={2} totalPages={3} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(screen.getByRole('button', { name: /Previous/ }))
    await userEvent.click(screen.getByRole('button', { name: /Next/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Page 3' }))
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([1, 3, 3])
  })

  test('previous is disabled on the first page and next on the last', () => {
    const { rerender } = render(<Pagination page={1} totalPages={2} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled()
    rerender(<Pagination page={2} totalPages={2} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled()
  })
})
