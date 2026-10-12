import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
})

// Attach JWT to every request if logged in
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('wt_token') || sessionStorage.getItem('wt_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Pull a readable error message out of any API error
export function errorMessage(err) {
  return err?.response?.data?.message || err.message || 'Something went wrong'
}

export default api
