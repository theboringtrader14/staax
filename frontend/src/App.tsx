import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import Layout from '@/components/layout/Layout'
import LandingPage from '@/pages/LandingPage'
import GridPage from '@/pages/GridPage'
import OrdersPage from '@/pages/OrdersPage'
import AlgoPage from '@/pages/AlgoPage'
import ReportsPage from '@/pages/ReportsPage'
import IndicatorsPage from '@/pages/IndicatorsPage'
import AnalyticsPage from '@/pages/AnalyticsPage'
import ZerodhaCallbackPage from '@/pages/ZerodhaCallbackPage'
import { useStore } from '@/store'
import { useEffect } from 'react'
import React from 'react'

const RequireAuth = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated } = useStore()
  useEffect(() => {
    if (!isAuthenticated) {
      const isLocal = window.location.hostname === 'localhost'
      window.location.href = isLocal ? 'http://localhost:3000' : 'https://lifexos.co.in'
    }
  }, [isAuthenticated])
  if (!isAuthenticated) return null
  return <>{children}</>
}
import { accountsAPI } from '@/services/api'
import DashboardPanel from '@/components/panels/DashboardPanel'
import AccountsDrawer from '@/components/panels/AccountsDrawer'
import { initSounds } from './utils/sounds'

export default function App() {
  const setAccounts = useStore(s => s.setAccounts)

  useEffect(() => {
    const saved = localStorage.getItem('staax_theme') ?? 'dark'
    document.documentElement.setAttribute('data-theme', saved)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (token) {
      useStore.getState().login(token)
      window.history.replaceState({}, '', window.location.pathname)
      window.location.replace('/grid')
    }
  }, [])

  // Load accounts on mount
  useEffect(() => {
    accountsAPI.list().then(r => setAccounts(r.data?.accounts || r.data || [])).catch((e) => { console.warn('[App] accounts load failed', e) })
  }, [setAccounts])

  // Resume AudioContext on first user interaction (browsers block autoplay)
  useEffect(() => {
    const init = () => { initSounds(); document.removeEventListener('click', init) }
    document.addEventListener('click', init)
    return () => document.removeEventListener('click', init)
  }, [])

  return (
    <>
      <Toaster position="bottom-right" />
      <BrowserRouter>
        <DashboardPanel />
        <AccountsDrawer />
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/zerodha/callback" element={<ZerodhaCallbackPage />} />

          {/* App routes — Layout is a pathless wrapper */}
          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            <Route path="/dashboard"  element={<Navigate to="/grid" replace />} />
            <Route path="/grid"       element={<GridPage />} />
            <Route path="/orders"     element={<OrdersPage />} />
            <Route path="/algo/new"   element={<AlgoPage />} />
            <Route path="/algo/:id"   element={<AlgoPage />} />
            <Route path="/reports"    element={<ReportsPage />} />
            <Route path="/accounts"   element={<Navigate to="/grid" replace />} />
            <Route path="/indicators" element={<IndicatorsPage />} />
            <Route path="/analytics"  element={<AnalyticsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </>
  )
}
