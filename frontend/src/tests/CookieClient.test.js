import { AxiosError } from 'axios'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import api, { clearCsrfToken, setCsrfToken } from '../api/client'

const originalAdapter = api.defaults.adapter
const response = (config, data = {}) => ({ config, data, status: 200, statusText: 'OK', headers: {} })
const reject = (config, status, code) => Promise.reject(new AxiosError('Request failed', undefined, config, undefined, { config, status, data: { code }, headers: {} }))
beforeEach(() => { clearCsrfToken(); localStorage.clear(); sessionStorage.clear() })
afterEach(() => { api.defaults.adapter = originalAdapter; clearCsrfToken() })

test('concurrent changes share one CSRF bootstrap and send cookies without Authorization credentials', async () => {
  localStorage.setItem('wt_token', 'old-token-must-not-be-sent')
  const requests = []
  let release
  api.defaults.adapter = async config => {
    requests.push(config)
    if (config.url === '/auth/csrf') {
      await new Promise(resolve => { release = resolve })
      return response(config, { csrfToken: 'anonymous-csrf' })
    }
    return response(config)
  }
  const writes = Promise.all([api.post('/one', { name: 'First' }), api.put('/two', { name: 'Second' })])
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  expect(requests).toHaveLength(1)
  release()
  await writes
  expect(requests.filter(r => r.url === '/auth/csrf')).toHaveLength(1)
  for (const config of requests) {
    expect(config.withCredentials).toBe(true)
    expect(config.headers.get('Authorization')).toBeUndefined()
  }
  for (const config of requests.filter(r => r.url !== '/auth/csrf')) expect(config.headers.get('X-CSRF-Token')).toBe('anonymous-csrf')
  expect(sessionStorage.getItem('wt_token')).toBeNull()
  expect(localStorage.getItem('wt_token')).toBe('old-token-must-not-be-sent')
})

test('login rotates the in-memory CSRF proof and GET requests do not require it', async () => {
  const seen = []
  api.defaults.adapter = async config => {
    seen.push(config)
    return response(config, config.url === '/auth/csrf' ? { csrfToken: 'before-login' }
      : config.url === '/auth/login' ? { user: { role: 'PARENT' }, csrfToken: 'after-login' } : {})
  }
  await api.get('/public/faq')
  await api.post('/auth/login', { email: 'parent@example.test' })
  await api.post('/parent/children', { name: 'Child' })
  expect(seen.find(r => r.url === '/public/faq').headers.get('X-CSRF-Token')).toBeUndefined()
  expect(seen.find(r => r.url === '/auth/login').headers.get('X-CSRF-Token')).toBe('before-login')
  expect(seen.find(r => r.url === '/parent/children').headers.get('X-CSRF-Token')).toBe('after-login')
  expect(localStorage.length + sessionStorage.length).toBe(0)
})

test('a stale CSRF proof is not refreshed or replayed under a potentially different account', async () => {
  setCsrfToken('stale')
  const changes = []
  api.defaults.adapter = async config => {
    changes.push(config)
    return reject(config, 403, 'CSRF_INVALID')
  }
  await expect(api.post('/parent/children', { name: 'Once' })).rejects.toHaveProperty('response.data.message', 'Your sign-in or security check changed. Refresh this page before submitting again.')
  expect(changes).toHaveLength(1)
  await expect(api.post('/parent/children', { name: 'Once' })).rejects.toHaveProperty('response.status', 403)
  expect(changes).toHaveLength(2)
  expect(changes.every(config => config.url === '/parent/children' && config.headers.get('X-CSRF-Token') === 'stale')).toBe(true)
})

test.each([[403, 'CSRF_ORIGIN'], [409, 'CONFLICT'], [500, undefined]])('does not replay a %s %s response', async (status, code) => {
  setCsrfToken('ready')
  const adapter = vi.fn(config => reject(config, status, code))
  api.defaults.adapter = adapter
  await expect(api.post('/parent/payments/checkout', { bookingId: 'booking' })).rejects.toHaveProperty('response.status', status)
  expect(adapter).toHaveBeenCalledTimes(1)
})

test('a failed CSRF bootstrap never sends an unprotected mutation', async () => {
  const seen = []
  api.defaults.adapter = config => {
    seen.push(config.url)
    return Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config))
  }
  await expect(api.post('/parent/children', {})).rejects.toHaveProperty('code', 'ERR_NETWORK')
  expect(seen).toEqual(['/auth/csrf'])
})
