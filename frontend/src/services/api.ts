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
  create:       (data: object) => api.post('/accounts/', data),
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
  angeloneFunds: (account: string, refresh = false) =>
    api.get(`/accounts/angelone/${account}/funds`, { params: refresh ? { refresh: true } : {} }),

  updateCredentials: (id: string, creds: { api_key?: string; api_secret?: string; totp_secret?: string }) =>
    api.patch(`/accounts/${id}/credentials`, creds),

  // All-accounts funds endpoint
  funds: () => api.get('/accounts/funds'),

  // FY margin endpoints
  getFYMargin:  () => api.get('/accounts/fy-margin'),
  saveFYMargin: (data: { account_id: string; fy_margin?: number; fy_brokerage?: number }) =>
    api.post('/accounts/fy-margin', data),
  stampFYMargin: () => api.post('/accounts/fy-margin/stamp-all'),

  // Initial capital baseline
  setInitialCapital: (id: string, amount: number) =>
    api.post(`/accounts/${id}/set-initial-capital`, { amount }),

  // Zerodha token flow
  zerodhaLoginUrl:    () => api.get('/accounts/zerodha/login-url'),
  zerodhaSetToken:    (requestToken: string) =>
    api.post('/accounts/zerodha/set-token', null, { params: { request_token: requestToken } }),
  zerodhaTokenStatus: () => api.get('/accounts/zerodha/token-status'),
}

// ── Algos — CRUD ──────────────────────────────────────────────────────────────
export const algosAPI = {
  list:      (params?: Record<string, unknown>) => api.get('/algos/', { params }),
  get:       (id: string) => api.get(`/algos/${id}`),
  create:    (data: object) => api.post('/algos/', data),
  update:    (id: string, data: object) => api.put(`/algos/${id}`, data),
  delete:    (id: string) => api.delete(`/algos/${id}`),
  archive:   (id: string) => api.post(`/algos/${id}/archive`),
  promote:   (id: string) => api.post(`/algos/${id}/promote`),
  demote:    (id: string) => api.post(`/algos/${id}/demote`),
  unarchive: (id: string) => api.post(`/algos/${id}/unarchive`),

  // Runtime controls (Orders page buttons)
  re:        (id: string) => api.post(`/algos/${id}/re`),
  sq:        (id: string, orderIds: string[] = []) =>
    api.post(`/orders/${id}/square-off`, { order_ids: orderIds.length ? orderIds : null, reason: 'manual_sq' }),
  terminate: (id: string) => api.post(`/algos/${id}/terminate`),
  duplicate: (id: string) => api.post(`/algos/${id}/duplicate`),
  updateRecurringDays: (id: string, days: string[]) =>
    api.patch(`/algos/${id}/recurring-days`, { days }),
  scheduleRemoval: (id: string, day: string) =>
    api.post(`/algos/${id}/schedule-removal`, { day }),
}

// ── Grid ──────────────────────────────────────────────────────────────────────
export const gridAPI = {
  // Load all entries for a week — used by GridPage on mount
  list: (params: { week_start: string; week_end: string; is_practix?: boolean; account_id?: string | null }) =>
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
  cancel:    (entryId: string) => api.patch(`/grid/${entryId}/cancel`),
  archive:   (entryId: string) => api.post(`/grid/${entryId}/archive`),
  unarchive: (entryId: string) => api.post(`/grid/${entryId}/unarchive`),

  // Toggle practix/live for a single entry
  setMode: (entryId: string, data: { is_practix: boolean }) =>
    api.post(`/grid/${entryId}/mode`, data),

  // Promote all entries for an algo to live
  promoteAllToLive: (algoId: string) =>
    api.post(`/grid/${algoId}/promote-live`),

  triggerNow: (algoId: string, date: string) => api.post('/grid/trigger-now', { algo_id: algoId, trading_date: date }),

  // Force mid-day activation — creates AlgoState(WAITING) for any today entries missing one
  activateNow: () => api.post('/grid/activate-now'),
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
  ltp: () =>
    api.get('/orders/ltp'),
  correctExitPrice: (orderId: string, price: number) =>
    api.patch(`/orders/${orderId}/exit-price`, { exit_price: price }),
  syncOrder: (algoId: string, data: object) =>
    api.post(`/orders/${algoId}/sync`, data),
  retryEntry: (gridEntryId: string) =>
    api.post(`/orders/${gridEntryId}/retry`),
  retryLegs: (gridEntryId: string, legIds: string[]) =>
    api.post(`/orders/${gridEntryId}/retry-legs`, { leg_ids: legIds }),
  positionCheck: (isPractix?: boolean) =>
    api.get('/orders/position-check', { params: isPractix !== undefined ? { is_practix: isPractix } : {} }),
  brokerOrderbook: () =>
    api.get('/orders/broker-orderbook'),
  weekSummary: (weekStart?: string, isPractix?: boolean) =>
    api.get('/orders/week-summary', { params: { ...(weekStart ? { week_start: weekStart } : {}), ...(isPractix !== undefined ? { is_practix: isPractix } : {}) } }),
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
  equityCurve:  (params?: object) => api.get('/reports/equity-curve',  { params }),
  metrics:      (params?: object) => api.get('/reports/metrics',        { params }),
  calendar:     (params?: object) => api.get('/reports/calendar',       { params }),
  download:     (params?: object) => api.get('/reports/download',       { params, responseType: 'blob' }),
  dayBreakdown:  (params?: object) => api.get('/reports/day-breakdown',  { params }),
  errors:        (params?: object) => api.get('/reports/errors',         { params }),
  slippage:      (params?: object) => api.get('/reports/slippage',       { params }),
  healthScores:  (params?: object) => api.get('/reports/health-scores',  { params }),
  timeHeatmap:   (params?: object) => api.get('/reports/time-heatmap',   { params }),
  latency:            (params?: object) => api.get('/reports/latency',             { params }),
  strategyBreakdown:  (params?: object) => api.get('/reports/strategy-breakdown',  { params }),
}

// ── System
export const systemAPI = {
  activateKillSwitch: (accountIds: string[] = []) => api.post('/system/kill-switch', { account_ids: accountIds }),
  killSwitchStatus:   () => api.get("/system/kill-switch/status"),
  ticker:             () => api.get("/system/ticker"),
  stats:              (isPractix?: boolean) => api.get("/system/stats", { params: isPractix !== undefined ? { is_practix: isPractix } : {} }),
  health:             () => api.get("/system/health"),
}

export const botsAPI = {
  list:          () => api.get('/bots/'),
  orders:        () => api.get('/bots/orders'),
  create:        (data: object) => api.post('/bots/', data),
  update:        (id: string, data: object) => api.patch(`/bots/${id}`, data),
  archive:       (id: string) => api.post(`/bots/${id}/archive`, {}),
  delete:        (id: string) => api.delete(`/bots/${id}`),
  botOrders:     (id: string) => api.get(`/bots/${id}/orders`),
  signals:       (id: string) => api.get(`/bots/${id}/signals`),
  signalsToday:  (days = 7) => api.get('/bots/signals/today', { params: { days } }),
  createSignal:  (id: string, data: object) => api.post(`/bots/${id}/signals`, data),
}

export const holidaysAPI = {
  list:   (year?: number) => api.get('/holidays/', { params: year ? { year } : {} }),
  sync:   () => api.post('/holidays/sync'),
  create: (data: { date: string; segment: string; description?: string }) => api.post('/holidays/', data),
  delete: (id: string) => api.delete(`/holidays/${id}`),
}

export const eventsAPI = {
  list:   (limit = 100, date?: string) => api.get('/events/', { params: date ? { limit, date } : { limit } }),
  export: () => api.get('/events/export', { responseType: 'blob' }),
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
export function createOrdersWebSocket(): WebSocket {
  const wsBase = API_BASE.replace('http', 'ws')
  return new WebSocket(`${wsBase}/api/v1/orders/ws/live`)
}

export function createNotificationsWebSocket(): WebSocket {
  const wsBase = API_BASE.replace('http', 'ws')
  return new WebSocket(`${wsBase}/ws/notifications`)
}
