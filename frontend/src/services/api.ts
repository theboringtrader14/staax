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

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authAPI = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
  me: () => api.get('/auth/me'),
}

// ── Accounts ──────────────────────────────────────────────────────────────────
export const accountsAPI = {
  list:         () => api.get('/accounts/'),
  status:       () => api.get('/accounts/status'),
  updateMargin: (id: string, data: object) =>
    api.post(`/accounts/${id}/margin`, data),
  updateGlobalRisk: (id: string, data: { global_sl?: number; global_tp?: number }) =>
    api.post(`/accounts/${id}/global-risk`, data),
  updateNickname: (id: string, nickname: string) =>
    api.patch(`/accounts/${id}/nickname`, { nickname }),
  angeloneLogin: (account: string) =>
    api.post(`/accounts/angelone/${account}/login`),
  angeloneAutoLogin: (account: string) =>
    api.post(`/accounts/angelone/${account}/auto-login`),
  angeloneTokenStatus: (account: string) =>
    api.get(`/accounts/angelone/${account}/token-status`),

  // Zerodha token flow
  zerodhaLoginUrl:    () => api.get('/accounts/zerodha/login-url'),
  zerodhaSetToken:    (requestToken: string) =>
    api.post('/accounts/zerodha/set-token', null, { params: { request_token: requestToken } }),
  zerodhaTokenStatus: () => api.get('/accounts/zerodha/token-status'),
}

// ── Algos — CRUD ──────────────────────────────────────────────────────────────
export const algosAPI = {
  list:      () => api.get('/algos/'),
  get:       (id: string) => api.get(`/algos/${id}`),
  create:    (data: object) => api.post('/algos/', data),
  update:    (id: string, data: object) => api.put(`/algos/${id}`, data),
  delete:    (id: string) => api.delete(`/algos/${id}`),
  archive:   (id: string) => api.post(`/algos/${id}/archive`),
  promote:   (id: string) => api.post(`/algos/${id}/promote`),
  demote:    (id: string) => api.post(`/algos/${id}/demote`),
  unarchive: (id: string) => api.post(`/algos/${id}/unarchive`),

  // Runtime controls (Orders page buttons)
  start:     (id: string) => api.post(`/algos/${id}/start`),
  re:        (id: string) => api.post(`/algos/${id}/re`),
  sq:        (id: string, legIds: string[] = []) =>
    api.post(`/algos/${id}/sq`, { leg_ids: legIds }),
  terminate: (id: string) => api.post(`/algos/${id}/terminate`),
}

// ── Grid ──────────────────────────────────────────────────────────────────────
export const gridAPI = {
  // Load all entries for a week — used by GridPage on mount
  list: (params: { week_start: string; week_end: string; is_practix?: boolean }) =>
    api.get('/grid/', { params }),

  // Deploy an algo to a day cell
  deploy: (data: {
    algo_id:         string
    trading_date:    string
    lot_multiplier?: number
    is_practix?:     boolean
  }) => api.post('/grid/', data),

  getEntry:  (entryId: string) => api.get(`/grid/${entryId}`),

  // Update multiplier or practix flag
  update: (entryId: string, data: {
    lot_multiplier?: number
    is_practix?:     boolean
    is_enabled?:     boolean
  }) => api.put(`/grid/${entryId}`, data),

  remove:    (entryId: string, removeRecurring = false) =>
    api.delete(`/grid/${entryId}`, { params: removeRecurring ? { remove_recurring: true } : {} }),
  archive:   (entryId: string) => api.post(`/grid/${entryId}/archive`),
  unarchive: (entryId: string) => api.post(`/grid/${entryId}/unarchive`),

  // Toggle practix/live for a single entry
  setMode: (entryId: string, data: { is_practix: boolean }) =>
    api.post(`/grid/${entryId}/mode`, data),

  // Promote all entries for an algo to live
  promoteAllToLive: (algoId: string) =>
    api.post(`/grid/${algoId}/promote-live`),
}

// ── Orders ────────────────────────────────────────────────────────────────────
export const openPositionsAPI = {
  list: (isPractix?: boolean) => api.get('/orders/open-positions', { params: isPractix !== undefined ? { is_practix: isPractix } : {} }),
}

export const ordersAPI = {
  list: (date?: string, isPractix?: boolean) =>
    api.get('/orders/', { params: { ...(date ? { trading_date: date } : {}), ...(isPractix !== undefined ? { is_practix: isPractix } : {}) } }),
  waiting: (date?: string, isPractix?: boolean) =>
    api.get('/orders/waiting', { params: { ...(date ? { trading_date: date } : {}), ...(isPractix !== undefined ? { is_practix: isPractix } : {}) } }),
  correctExitPrice: (orderId: string, price: number) =>
    api.patch(`/orders/${orderId}/exit-price`, { exit_price: price }),
  syncOrder: (algoId: string, data: object) =>
    api.post(`/orders/${algoId}/sync`, data),
}

// ── Services (Dashboard panel) ────────────────────────────────────────────────
export const servicesAPI = {
  status:   () => api.get('/services/'),
  startAll: () => api.post('/services/start-all'),
  stopAll:  () => api.post('/services/stop-all'),
  start:    (serviceId: string) => api.post(`/services/${serviceId}/start`),
  stop:     (serviceId: string) => api.post(`/services/${serviceId}/stop`),
}

// ── Reports ───────────────────────────────────────────────────────────────────
export const reportsAPI = {
  equityCurve: (params?: object) => api.get('/reports/equity-curve', { params }),
  metrics:     (params?: object) => api.get('/reports/metrics',       { params }),
  calendar:    (params?: object) => api.get('/reports/calendar',      { params }),
  download:    (params?: object) => api.get('/reports/download',      { params, responseType: 'blob' }),
}

// ── System
export const systemAPI = {
  activateKillSwitch: (accountIds: string[] = []) => api.post('/system/kill-switch', { account_ids: accountIds }),
  killSwitchStatus:   () => api.get("/system/kill-switch/status"),
  ticker:             () => api.get("/system/ticker"),
  stats:              (isPractix?: boolean) => api.get("/system/stats", { params: isPractix !== undefined ? { is_practix: isPractix } : {} }),
}

export const botsAPI = {
  list:    () => api.get('/bots/'),
  create:  (data: any) => api.post('/bots/', data),
  update:  (id: string, data: any) => api.patch(`/bots/${id}`, data),
  archive: (id: string) => api.post(`/bots/${id}/archive`, {}),
  delete:  (id: string) => api.delete(`/bots/${id}`),
  orders:  (id: string) => api.get(`/bots/${id}/orders`),
}

export const eventsAPI = {
  list:   (limit = 100) => api.get('/events/', { params: { limit } }),
  export: () => api.get('/events/export', { responseType: 'blob' }),
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
export function createOrdersWebSocket(): WebSocket {
  const wsBase = API_BASE.replace('http', 'ws')
  return new WebSocket(`${wsBase}/ws/live`)
}

export function createNotificationsWebSocket(): WebSocket {
  const wsBase = API_BASE.replace('http', 'ws')
  return new WebSocket(`${wsBase}/ws/notifications`)
}
