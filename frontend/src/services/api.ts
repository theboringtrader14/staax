import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export const api = axios.create({
  baseURL: `${API_BASE}/api/v1`,
  timeout: 10000,
})

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('staax_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Auth ──────────────────────────────────────────
export const authAPI = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
  me: () => api.get('/auth/me'),
}

// ── Accounts ──────────────────────────────────────
export const accountsAPI = {
  list: () => api.get('/accounts/'),
  tokenStatus: (id: string) => api.get(`/accounts/${id}/token-status`),
  updateMargin: (id: string, data: object) => api.post(`/accounts/${id}/margin`, data),
}

// ── Algos ─────────────────────────────────────────
export const algosAPI = {
  list: () => api.get('/algos/'),
  get: (id: string) => api.get(`/algos/${id}`),
  create: (data: object) => api.post('/algos/', data),
  update: (id: string, data: object) => api.put(`/algos/${id}`, data),
  delete: (id: string) => api.delete(`/algos/${id}`),
}

// ── Grid ──────────────────────────────────────────
export const gridAPI = {
  getWeek: () => api.get('/grid/week'),
  deploy: (data: object) => api.post('/grid/deploy', data),
  updateMultiplier: (entryId: string, multiplier: number) =>
    api.patch(`/grid/${entryId}/multiplier`, { multiplier }),
  removeFromDay: (entryId: string) => api.delete(`/grid/${entryId}`),
}

// ── Orders ────────────────────────────────────────
export const ordersAPI = {
  list: () => api.get('/orders/'),
  correctExitPrice: (orderId: string, price: number) =>
    api.patch(`/orders/${orderId}/exit-price`, { price }),
  syncOrder: (algoId: string, data: object) => api.post(`/orders/${algoId}/sync`, data),
  squareOff: (algoId: string) => api.post(`/orders/${algoId}/square-off`),
}

// ── Reports ───────────────────────────────────────
export const reportsAPI = {
  equityCurve: (params?: object) => api.get('/reports/equity-curve', { params }),
  metrics: (params?: object) => api.get('/reports/metrics', { params }),
  calendar: (params?: object) => api.get('/reports/calendar', { params }),
}

// ── WebSocket ─────────────────────────────────────
export function createOrdersWebSocket() {
  const wsBase = API_BASE.replace('http', 'ws')
  return new WebSocket(`${wsBase}/api/v1/orders/ws/live`)
}
