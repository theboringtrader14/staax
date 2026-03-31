import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import ZerodhaCallbackPage from './pages/ZerodhaCallbackPage'
import Layout from '@/components/layout/Layout'
import LoginPage from '@/pages/LoginPage'
import LandingPage from '@/pages/LandingPage'
import GridPage from '@/pages/GridPage'
import OrdersPage from '@/pages/OrdersPage'
import AlgoPage from '@/pages/AlgoPage'
import ReportsPage from '@/pages/ReportsPage'
import AccountsPage from '@/pages/AccountsPage'
import DashboardPage from '@/pages/DashboardPage'
import IndicatorsPage from '@/pages/IndicatorsPage'
import AnalyticsPage from '@/pages/AnalyticsPage'
import { useStore } from '@/store'
import { useEffect } from 'react'
import { accountsAPI } from '@/services/api'

/** Redirect unauthenticated users to the landing page */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useStore(s => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  // Apply saved theme on mount
  const theme = localStorage.getItem('staax_theme') || 'dark'
  document.documentElement.setAttribute('data-theme', theme)
  const setAccounts     = useStore(s => s.setAccounts)
  const isAuthenticated = useStore(s => s.isAuthenticated)

  // Load accounts once on auth — makes dropdown available on all pages
  useEffect(() => {
    if (!isAuthenticated) return
    accountsAPI.list().then(r => setAccounts(r.data?.accounts || r.data || [])).catch(() => {})
  }, [isAuthenticated, setAccounts])

  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/zerodha-callback" element={<ZerodhaCallbackPage />} />

        {/* Protected app routes — Layout is a pathless wrapper so sidebar links stay as /dashboard etc */}
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route path="/dashboard"  element={<DashboardPage />} />
          <Route path="/grid"       element={<GridPage />} />
          <Route path="/orders"     element={<OrdersPage />} />
          <Route path="/algo/new"   element={<AlgoPage />} />
          <Route path="/algo/:id"   element={<AlgoPage />} />
          <Route path="/reports"    element={<ReportsPage />} />
          <Route path="/accounts"   element={<AccountsPage />} />
          <Route path="/indicators" element={<IndicatorsPage />} />
          <Route path="/analytics"  element={<AnalyticsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
