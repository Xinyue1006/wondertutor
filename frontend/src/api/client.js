import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 20000,
})

// Attach JWT to every request if logged in
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('wt_token') || sessionStorage.getItem('wt_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Pull a readable error message out of any API error
export function errorMessage(err) {
  if (err?.response?.data?.message) return err.response.data.message
  if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') return 'The request took too long. Check the current status, then try again if needed.'
  if (err?.code === 'ERR_NETWORK') return 'Unable to reach WonderTutor. Check your connection and try again.'
  return err?.message || 'Something went wrong. Please try again.'
}

export default api
