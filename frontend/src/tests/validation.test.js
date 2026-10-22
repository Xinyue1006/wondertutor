import { describe, expect, test } from 'vitest'
import { checkEmail, checkName, checkPassword, checkPhone, checkRinggit, checkText, normalizePhone } from '../lib/validation'

describe('form validation rules (same as the server)', () => {
  test('Malaysian phone numbers in any common format', () => {
    expect(normalizePhone('012-345 6789')).toBe('+60123456789')
    expect(normalizePhone('+60 11-2345 6789')).toBe('+601123456789')
    expect(normalizePhone('03-1234 5678')).toBe('+60312345678')
    expect(normalizePhone('12345')).toBeNull()
    expect(checkPhone('+65 9123 4567')).toBe('') // another country, written with its country code
    expect(checkPhone('+65 12')).toContain('country code')
    expect(normalizePhone('+65 9123 4567')).toBe('+6591234567')
    expect(checkPhone('')).toBe('Enter the phone number.')
    expect(checkPhone('0123456789')).toBe('')
  })

  test('names allow Malaysian name forms but not digits or symbols', () => {
    for (const ok of ['Miki Lim', 'Rajesh a/l Kumar', 'Nur Aisyah binti Ahmad', '陈小明', "O'Neil"]) expect(checkName(ok)).toBe('')
    expect(checkName('Miki123')).toContain('only contain letters')
    expect(checkName('M')).toContain('at least 2')
    expect(checkName('a'.repeat(61), "Child's name", 60)).toContain('60 characters')
  })

  test('email and password', () => {
    expect(checkEmail('miki@example.com')).toBe('')
    expect(checkEmail('miki@')).toContain('valid email')
    expect(checkPassword('Parent1234')).toBe('')
    expect(checkPassword('short1')).toContain('at least 8')
    expect(checkPassword('onlyletters')).toContain('letter and a number')
    expect(checkPassword(`${'a'.repeat(72)}1`)).toContain('72 characters')
  })

  test('ringgit amounts and text length', () => {
    expect(checkRinggit('50')).toBe('')
    expect(checkRinggit('50.5')).toBe('')
    expect(checkRinggit('50.555', 'Proposed price')).toContain('2 decimal places')
    expect(checkRinggit('0', 'Proposed price')).toContain('more than RM0')
    expect(checkRinggit('1001', 'Proposed price')).toContain('RM1000')
    expect(checkText('short', { label: 'The description', min: 10 })).toContain('at least 10')
    expect(checkText('x'.repeat(201), { label: 'Message', max: 200 })).toContain('200 characters')
  })
})
