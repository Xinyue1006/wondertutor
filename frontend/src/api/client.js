import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 20000,
  withCredentials: true,
})

// The login credential stays in an HttpOnly cookie. Only the CSRF proof is
// readable by this app, and it is kept in memory rather than browser storage.
let csrfToken = null
let csrfRequest = null
let csrfVersion = 0

export function setCsrfToken(token) {
  const nextToken = typeof token === 'string' && token ? token : null
  if (csrfToken === nextToken) return
  csrfToken = nextToken
  csrfVersion += 1
}

export function clearCsrfToken() {
  setCsrfToken(null)
}

// An old request finishing after a new login must not end that newer session.
export const isCurrentSessionRequest = config => config?._sessionVersion === csrfVersion

export async function ensureCsrfToken({ refresh = false } = {}) {
  if (!refresh && csrfToken) return csrfToken
  if (!csrfRequest) {
    const version = csrfVersion
    csrfRequest = api.get('/auth/csrf')
      .then(({ data }) => {
        if (typeof data.csrfToken !== 'string' || !data.csrfToken) throw new Error('Unable to start the security check. Please try again.')
        // A login/logout response may have rotated the token while this request
        // was in flight. Never replace that newer session's proof with this one.
        if (version === csrfVersion) setCsrfToken(data.csrfToken)
        return csrfToken
      })
      .finally(() => { csrfRequest = null })
  }
  return csrfRequest
}

const unsafe = (method) => !['get', 'head', 'options'].includes((method || 'get').toLowerCase())
api.interceptors.request.use(async (config) => {
  if (unsafe(config.method)) {
    const token = await ensureCsrfToken()
    config.headers.set('X-CSRF-Token', token)
  }
  config._sessionVersion = csrfVersion
  return config
})

api.interceptors.response.use((response) => {
  if (response.config.url !== '/auth/csrf' && response.data?.csrfToken && isCurrentSessionRequest(response.config)) setCsrfToken(response.data.csrfToken)
  return response
}, (error) => {
  // A different tab may have switched accounts. Preserve the old proof and form;
  // never replay a change using a newly discovered account's cookie session.
  if (error.response?.status === 403 && error.response.data?.code === 'CSRF_INVALID') {
    error.response.data.message = 'Your sign-in or security check changed. Refresh this page before submitting again.'
  }
  return Promise.reject(error)
})

// Pull a readable error message out of any API error
export function errorMessage(err) {
  if (err?.response?.data?.message) return err.response.data.message
  if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') return 'The request took too long. Check the current status, then try again if needed.'
  if (err?.code === 'ERR_NETWORK') return 'Unable to reach WonderTutor. Check your connection and try again.'
  return err?.message || 'Something went wrong. Please try again.'
}

export default api
