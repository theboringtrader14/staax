import { create } from 'zustand'
import { Account, Algo, GridEntry, Order } from '@/types'

interface Notification {
  id:    string
  type:  'info' | 'warn' | 'error' | 'success'
  msg:   string
  time:  string
  read:  boolean
}

interface STAAXStore {
  // Auth
  isAuthenticated: boolean
  token:           string | null
  setAuthenticated: (v: boolean) => void
  setToken:        (token: string | null) => void
  login:           (token: string) => void
  logout:          () => void

  // Accounts
  accounts:       Account[]
  activeAccount:  string | null
  setAccounts:    (accounts: Account[]) => void
  setActiveAccount: (id: string | null) => void

  // Algos
  algos:    Algo[]
  setAlgos: (algos: Algo[]) => void

  // Grid
  gridEntries:    GridEntry[]
  setGridEntries: (entries: GridEntry[]) => void

  // Orders
  orders:      Order[]
  setOrders:   (orders: Order[]) => void
  updateOrder: (id: string, updates: Partial<Order>) => void

  // Live P&L (updated via WebSocket)
  livePnl:    number
  setLivePnl: (pnl: number) => void

  // Theme
  theme:      'dark' | 'light'
  toggleTheme: () => void

  // Notifications (from WebSocket /ws/notifications)
  notifications:    Notification[]
  addNotification:  (n: Omit<Notification, 'id' | 'read'>) => void
  markAllRead:      () => void
  unreadCount:      () => number

  // UI
  isPractixMode:    boolean
  setIsPractixMode: (v: boolean) => void
  showWeekends:     boolean
  setShowWeekends:  (v: boolean) => void
}

export const useStore = create<STAAXStore>((set, get) => ({
  // ── Auth ────────────────────────────────────────────────────────────────────
  isAuthenticated: !!localStorage.getItem('staax_token'),
  token: localStorage.getItem('staax_token'),

  setAuthenticated: (v) => set({ isAuthenticated: v }),
  setToken: (token) => {
    if (token) localStorage.setItem('staax_token', token)
    else localStorage.removeItem('staax_token')
    set({ token })
  },
  login: (token) => {
    localStorage.setItem('staax_token', token)
    set({ token, isAuthenticated: true })
  },
  logout: () => {
    localStorage.removeItem('staax_token')
    set({ token: null, isAuthenticated: false, accounts: [], algos: [], orders: [] })
  },

  // ── Accounts ─────────────────────────────────────────────────────────────────
  accounts: [],
  activeAccount: null,
  setAccounts: (accounts) => set({ accounts }),
  setActiveAccount: (id) => set({ activeAccount: id }),

  // ── Algos ────────────────────────────────────────────────────────────────────
  algos: [],
  setAlgos: (algos) => set({ algos }),

  // ── Grid ─────────────────────────────────────────────────────────────────────
  gridEntries: [],
  setGridEntries: (entries) => set({ gridEntries: entries }),

  // ── Orders ───────────────────────────────────────────────────────────────────
  orders: [],
  setOrders: (orders) => set({ orders }),
  updateOrder: (id, updates) =>
    set((state) => ({
      orders: state.orders.map(o => o.id === id ? { ...o, ...updates } : o)
    })),

  // ── Live P&L ──────────────────────────────────────────────────────────────
  livePnl: 0,
  setLivePnl: (pnl) => set({ livePnl: pnl }),

  // ── Notifications ─────────────────────────────────────────────────────────
  theme: (localStorage.getItem('staax_theme') as 'dark' | 'light') || 'dark',
  toggleTheme: () => set(state => {
    const next = state.theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem('staax_theme', next)
    document.documentElement.setAttribute('data-theme', next)
    return { theme: next }
  }),
  notifications: [],
  addNotification: (n) =>
    set((state) => ({
      notifications: [
        { ...n, id: `notif-${Date.now()}`, read: false },
        ...state.notifications.slice(0, 49),   // keep max 50
      ]
    })),
  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map(n => ({ ...n, read: true }))
    })),
  unreadCount: () => get().notifications.filter(n => !n.read).length,

  // ── UI ────────────────────────────────────────────────────────────────────
  isPractixMode: true,
  setIsPractixMode: (v) => set({ isPractixMode: v }),
  showWeekends: false,
  setShowWeekends: (v) => set({ showWeekends: v }),
}))
