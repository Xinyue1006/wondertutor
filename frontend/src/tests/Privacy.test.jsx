import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Privacy from '../pages/Privacy'

const renderPage = () => render(<MemoryRouter><Privacy /></MemoryRouter>)

describe('Privacy Notice page', () => {
  test('has the sections a parent looks for, in plain language', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Notice' })).toBeInTheDocument()
    for (const title of ['Who we are', 'What we collect', 'Why we use it', 'Who can see it', 'Children’s information', 'How long we keep it', 'Your rights', 'Keeping it safe', 'Using WonderTutor']) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument()
    }
    expect(screen.getByText(/Last updated/)).toBeInTheDocument()
  })

  test('says where to download, correct and delete the data', () => {
    renderPage()
    expect(screen.getByText(/Download my data/)).toBeInTheDocument()
    expect(screen.getByText(/Delete my account/)).toBeInTheDocument()
  })
})
