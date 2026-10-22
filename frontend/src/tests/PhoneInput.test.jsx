import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PhoneInput from '../components/PhoneInput'
import { joinPhone, splitPhone, hasForbiddenCharacters, COUNTRIES } from '../lib/phone'
import { checkPhone } from '../lib/validation'

// A tiny parent, like a real form: it keeps the value and shows what the server would receive
function Harness({ initial = '', error }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <PhoneInput value={value} onChange={setValue} error={error} />
      <output data-testid="sent">{value}</output>
    </>
  )
}
const sent = () => screen.getByTestId('sent').textContent

describe('phone number rules (country list)', () => {
  test('a saved international number is split into country and number', () => {
    expect(splitPhone('+60123456789')).toMatchObject({ country: { iso: 'MY' }, national: '123456789' })
    expect(splitPhone('+6591234567')).toMatchObject({ country: { iso: 'SG' }, national: '91234567' })
    expect(splitPhone('+85251234567')).toMatchObject({ country: { iso: 'HK' }, national: '51234567' }) // longest code wins
    expect(splitPhone('012-345 6789')).toMatchObject({ country: { iso: 'MY' }, national: '012-345 6789' }) // typed the local way
    expect(splitPhone('')).toMatchObject({ country: { iso: 'MY' }, national: '' })
  })

  test('the number sent is the country code plus the digits, without the leading 0', () => {
    const my = COUNTRIES.find((c) => c.iso === 'MY')
    expect(joinPhone(my, '012-345 6789')).toBe('+60123456789')
    expect(joinPhone(my, '12 345 6789')).toBe('+60123456789')
    expect(joinPhone(my, '')).toBe('')
    expect(joinPhone(my, '+65 9123 4567')).toBe('+65 9123 4567') // a pasted international number is believed
  })
})

describe('phone box', () => {
  test('starts with Malaysia +60 and sends the full number', async () => {
    render(<Harness />)
    expect(screen.getByLabelText('Country code')).toHaveValue('MY')
    await userEvent.type(screen.getByLabelText('Phone number'), '012-345 6789')
    expect(sent()).toBe('+60123456789')
  })

  test('shows a saved number with the right country', () => {
    render(<Harness initial="+6591234567" />)
    expect(screen.getByLabelText('Country code')).toHaveValue('SG')
    expect(screen.getByLabelText('Phone number')).toHaveValue('91234567')
  })

  test('changing the country changes the code that is sent, and the example', async () => {
    render(<Harness initial="+60123456789" />)
    await userEvent.selectOptions(screen.getByLabelText('Country code'), 'SG')
    expect(sent()).toBe('+65123456789')
    expect(screen.getByText(/Example: 9123 4567/)).toBeInTheDocument()
  })

  test('shows the error next to the box', () => {
    render(<Harness error="Enter a valid phone number." />)
    expect(screen.getByText('Enter a valid phone number.')).toBeInTheDocument()
    expect(screen.getByLabelText('Phone number')).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('letters are not a phone number', () => {
  test('the box says so while typing, and the value sent keeps the letters so the form refuses it', async () => {
    render(<Harness />)
    await userEvent.type(screen.getByLabelText('Phone number'), 'abc0123')
    expect(screen.getByText(/Use numbers only/)).toBeInTheDocument()
    expect(screen.getByLabelText('Phone number')).toHaveAttribute('aria-invalid', 'true')
    expect(sent()).toContain('abc') // not quietly turned into the digits that are left
    expect(checkPhone(sent())).toContain('valid')
  })

  test('digits, spaces, dashes and brackets are fine', async () => {
    render(<Harness />)
    await userEvent.type(screen.getByLabelText('Phone number'), '(012) 345-6789')
    expect(screen.queryByText(/Use numbers only/)).not.toBeInTheDocument()
    expect(sent()).toBe('+60123456789')
  })

  test('joinPhone keeps invalid characters instead of dropping them', () => {
    const my = COUNTRIES.find((c) => c.iso === 'MY')
    expect(joinPhone(my, '12ab34')).toBe('+6012ab34')
    expect(hasForbiddenCharacters('12ab34')).toBe(true)
    expect(hasForbiddenCharacters('+65 (9123)-4567.')).toBe(false)
  })
})
