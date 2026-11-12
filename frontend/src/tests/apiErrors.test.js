import { expect, test } from 'vitest'
import { errorMessage } from '../api/client'

test('failed connections and timeouts have recovery instructions; server validation is preserved', () => {
  expect(errorMessage({ code: 'ERR_NETWORK' })).toMatch(/Check your connection/)
  expect(errorMessage({ code: 'ECONNABORTED' })).toMatch(/took too long/)
  expect(errorMessage({ response: { data: { message: 'Choose a subject' } } })).toBe('Choose a subject')
})
