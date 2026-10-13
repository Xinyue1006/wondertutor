import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import TutorCard from '../components/TutorCard'

const tutor = {
  id: 7, name: 'Daniel Tan', photoUrl: null, verified: true, rating: 4.9, reviewCount: 128, hourlyRate: 60,
  mainSubject: 'Mathematics', levels: 'Primary 5 – Secondary 3', offersOnline: true, offersPhysical: true,
  location: 'Kepong, Kuala Lumpur', availableDays: ['Tue', 'Thu', 'Sat'], recommended: false,
}
const match = {
  score: 92,
  label: 'Highly suitable',
  reasons: ['Mathematics specialist', 'Primary 5 experience', 'Available on your preferred days', 'Within your budget'],
}

const renderCard = (props) => render(<MemoryRouter><TutorCard tutor={tutor} {...props} /></MemoryRouter>)

describe('TutorCard (browse)', () => {
  test('shows the key facts from the mockup', () => {
    renderCard()
    expect(screen.getByText('Daniel Tan')).toBeInTheDocument()
    expect(screen.getByText(/RM 60/)).toBeInTheDocument()
    expect(screen.getByText('4.9')).toBeInTheDocument()
    expect(screen.getByText(/128 reviews/)).toBeInTheDocument()
    expect(screen.getByText('Online')).toBeInTheDocument()
    expect(screen.getByText('Physical')).toBeInTheDocument()
    expect(screen.getByText(/Available: Tue, Thu, Sat/)).toBeInTheDocument()
    expect(screen.queryByText(/% Match/)).not.toBeInTheDocument()
  })

  test('links go to the profile and the booking page', () => {
    renderCard()
    expect(screen.getByRole('link', { name: 'View Profile' })).toHaveAttribute('href', '/parent/tutors/7')
    expect(screen.getByRole('link', { name: 'Book a Lesson' })).toHaveAttribute('href', '/parent/tutors/7/book')
  })

  test('the recommended tag appears only when flagged', () => {
    renderCard({ tutor: { ...tutor, recommended: true } })
    expect(screen.getByText('Recommended for your child')).toBeInTheDocument()
  })

  test('online-only tutors do not show the Physical tag', () => {
    renderCard({ tutor: { ...tutor, offersPhysical: false } })
    expect(screen.queryByText('Physical')).not.toBeInTheDocument()
  })
})

describe('TutorCard (matching result)', () => {
  test('shows match percentage, label and the first three reasons', () => {
    renderCard({ match })
    expect(screen.getByText('92% Match')).toBeInTheDocument()
    expect(screen.getByText('Highly suitable')).toBeInTheDocument()
    expect(screen.getByText('Why we recommend this tutor')).toBeInTheDocument()
    expect(screen.getByText('Mathematics specialist')).toBeInTheDocument()
    expect(screen.queryByText('Within your budget')).not.toBeInTheDocument()
  })

  test('"View more" reveals the remaining reasons', async () => {
    renderCard({ match })
    await userEvent.click(screen.getByRole('button', { name: /View more/ }))
    expect(screen.getByText('Within your budget')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /View less/ })).toBeInTheDocument()
  })
})

describe('TutorCard (save button)', () => {
  test('only appears when the page supports saving, and reports the saved state', async () => {
    const { unmount } = renderCard()
    expect(screen.queryByRole('button', { name: /Save Daniel Tan/ })).not.toBeInTheDocument()
    unmount()
    const onToggleSave = vi.fn()
    renderCard({ saved: false, onToggleSave })
    const heart = screen.getByRole('button', { name: 'Save Daniel Tan' })
    expect(heart).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(heart)
    expect(onToggleSave).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }))
  })

  test('a saved tutor offers to remove it', () => {
    renderCard({ saved: true, onToggleSave: () => {} })
    expect(screen.getByRole('button', { name: 'Remove Daniel Tan from saved tutors' })).toHaveAttribute('aria-pressed', 'true')
  })
})
