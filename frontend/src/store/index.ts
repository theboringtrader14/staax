import { create } from 'zustand'
import { Account, Algo, GridEntry, Order } from '@/types'

interface STAAXStore {
  // Auth
  isAuthenticated: boolean
  setAuthenticated: (v: boolean) => void

  // Accounts
  accounts: Account[]
  activeAccount: string | null
  setAccounts: (accounts: Account[]) => void
  setActiveAccount: (id: string | null) => void

  // Algos
  algos: Algo[]
  setAlgos: (algos: Algo[]) => void

  // Grid
  gridEntries: GridEntry[]
  setGridEntries: (entries: GridEntry[]) => void

  // Orders
  orders: Order[]
  setOrders: (orders: Order[]) => void
  updateOrder: (id: string, updates: Partial<Order>) => void

  // UI
  isPractixMode: boolean
  setIsPractixMode: (v: boolean) => void
  showWeekends: boolean
  setShowWeekends: (v: boolean) => void
}

export const useStore = create<STAAXStore>((set) => ({
  isAuthenticated: false,
  setAuthenticated: (v) => set({ isAuthenticated: v }),

  accounts: [],
  activeAccount: null,
  setAccounts: (accounts) => set({ accounts }),
  setActiveAccount: (id) => set({ activeAccount: id }),

  algos: [],
  setAlgos: (algos) => set({ algos }),

  gridEntries: [],
  setGridEntries: (entries) => set({ gridEntries: entries }),

  orders: [],
  setOrders: (orders) => set({ orders }),
  updateOrder: (id, updates) => set((state) => ({
    orders: state.orders.map(o => o.id === id ? { ...o, ...updates } : o)
  })),

  isPractixMode: true,
  setIsPractixMode: (v) => set({ isPractixMode: v }),
  showWeekends: false,
  setShowWeekends: (v) => set({ showWeekends: v }),
}))
