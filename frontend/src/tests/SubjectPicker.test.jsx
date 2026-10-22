import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SubjectPicker from '../components/SubjectPicker'
import { childSubjects, keepAllowed, subjectsForLevel } from '../lib/subjects'
import { parseText } from '../assistant/parseText'

const SUBJECTS = ['Mathematics', 'English', 'Science', 'Physics', 'Computer Science', 'Economics']
const LEVELS = {
  Mathematics: ['KINDERGARTEN', 'PRIMARY', 'SECONDARY'], English: ['KINDERGARTEN', 'PRIMARY', 'SECONDARY'],
  Science: ['PRIMARY', 'SECONDARY'], 'Computer Science': ['PRIMARY', 'SECONDARY'], Physics: ['SECONDARY'], Economics: ['SECONDARY'],
}

function Harness({ level = 'PRIMARY', initial = [], max = 6 }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <SubjectPicker value={value} onChange={setValue} level={level} subjects={SUBJECTS} subjectLevels={LEVELS} max={max} />
      <output data-testid="chosen">{value.join('|')}</output>
    </>
  )
}
const chosen = () => screen.getByTestId('chosen').textContent

describe('subject helpers', () => {
  test('a child saved with one subject (older record) or a list is read the same way', () => {
    expect(childSubjects({ subjects: ['Mathematics', 'Science'], subject: 'Mathematics' })).toEqual(['Mathematics', 'Science'])
    expect(childSubjects({ subject: 'English' })).toEqual(['English'])
    expect(childSubjects({ subjects: [], subject: null })).toEqual([])
    expect(childSubjects(undefined)).toEqual([])
  })

  test('only the subjects that exist at a level are offered', () => {
    expect(subjectsForLevel(SUBJECTS, LEVELS, 'PRIMARY')).toEqual(['Mathematics', 'English', 'Science', 'Computer Science'])
    expect(subjectsForLevel(SUBJECTS, LEVELS, 'KINDERGARTEN')).toEqual(['Mathematics', 'English'])
    expect(subjectsForLevel(SUBJECTS, LEVELS, 'SECONDARY')).toHaveLength(6)
    expect(subjectsForLevel(SUBJECTS, null, 'PRIMARY')).toHaveLength(6) // the server sent no map: offer everything
  })

  test('changing the level drops the subjects that do not exist at the new level', () => {
    expect(keepAllowed(['Physics', 'Mathematics'], SUBJECTS, LEVELS, 'PRIMARY')).toEqual(['Mathematics'])
    expect(keepAllowed(['Physics', 'Mathematics'], SUBJECTS, LEVELS, 'SECONDARY')).toEqual(['Physics', 'Mathematics'])
  })
})

describe('subject picker', () => {
  test('shows only the subjects of the level', () => {
    render(<Harness level="PRIMARY" />)
    expect(screen.getByRole('button', { name: 'Science' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Computer Science' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Physics' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Economics' })).not.toBeInTheDocument()
  })

  test('asks for the level first when there is none', () => {
    render(<Harness level="" />)
    expect(screen.getByText(/Choose the education level first/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  test('several subjects can be chosen and removed again', async () => {
    render(<Harness level="SECONDARY" />)
    await userEvent.click(screen.getByRole('button', { name: 'Physics' }))
    await userEvent.click(screen.getByRole('button', { name: 'Economics' }))
    expect(chosen()).toBe('Physics|Economics')
    expect(screen.getByText(/2 chosen/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Physics' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Physics' }))
    expect(chosen()).toBe('Economics')
  })

  test('stops at the maximum and says so, but a chosen subject can still be removed', async () => {
    render(<Harness level="SECONDARY" max={2} initial={['Physics', 'Economics']} />)
    expect(screen.getByRole('button', { name: 'Mathematics' })).toBeDisabled()
    expect(screen.getByText(/most you can choose \(2\)/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Physics' }))
    expect(screen.getByRole('button', { name: 'Mathematics' })).toBeEnabled()
  })
})

describe('the chatbot understands the SPM subjects', () => {
  const catalog = { subjects: SUBJECTS }
  test.each([
    ['my son needs sejarah help', 'History'],
    ['add maths for form 4', 'Additional Mathematics'],
    ['fizik and kimia', 'Physics'],
    ['Computer Science form 5', 'Computer Science'],
    ['cs tuition', 'Computer Science'],
    ['accounting for spm', 'Principles of Accounting'],
    ['ekonomi', 'Economics'],
    ['bi for primary 3', 'English'],
    ['pendidikan islam', 'Islamic Education'],
  ])('"%s" is read as %s', (text, expected) => {
    expect(parseText(text, catalog).found.subject).toBe(expected)
  })
})
