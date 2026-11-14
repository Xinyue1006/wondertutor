import { fireEvent, render, screen } from '@testing-library/react'
import Avatar from '../components/ui/Avatar'

describe('Avatar', () => {
  test('shows the photo when there is one', () => {
    render(<Avatar src="https://res.cloudinary.com/demo/me.jpg" name="Xin Yue Tan" />)
    const img = screen.getByRole('img', { name: 'Xin Yue Tan' })
    expect(img).toHaveAttribute('src', 'https://res.cloudinary.com/demo/me.jpg')
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer')
  })

  test('shows the initials when there is no photo', () => {
    render(<Avatar name="Xin Yue Tan" />)
    expect(screen.getByText('XY')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  test.each([
    '/img/people/daniel-tan.jpg',
    'img/people/parent-tan-xin-yue.jpg',
    'http://localhost:5173/img/people/sarah-tan.jpg',
    'https://wondertutor.example/img/people/lee-xin-yi.jpg?version=1',
  ])('uses name initials instead of the old AI demo portrait: %s', (src) => {
    render(<Avatar src={src} name="Ms. Lee Xin Yi" />)
    expect(screen.getByText('LX')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  test('still shows a real Google account photo', () => {
    render(<Avatar src="https://lh3.googleusercontent.com/real-account" name="Xin Yue Tan" />)
    expect(screen.getByRole('img', { name: 'Xin Yue Tan' })).toHaveAttribute('src', 'https://lh3.googleusercontent.com/real-account')
  })

  test('falls back to the initials, not a broken-image icon, when the picture cannot be loaded', () => {
    render(<Avatar src="https://lh3.googleusercontent.com/blocked" name="Xin Yue Tan" />)
    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('XY')).toBeInTheDocument()
  })

  test('a new photo address is tried again after an earlier one failed', () => {
    const { rerender } = render(<Avatar src="https://example.com/old.jpg" name="Xin Yue Tan" />)
    fireEvent.error(screen.getByRole('img'))
    rerender(<Avatar src="https://res.cloudinary.com/demo/new.jpg" name="Xin Yue Tan" />)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://res.cloudinary.com/demo/new.jpg')
  })
})
