import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from '@/components/layout/Layout'
import LandingPage from '@/pages/LandingPage'
import GridPage from '@/pages/GridPage'
import OrdersPage from '@/pages/OrdersPage'
import AlgoPage from '@/pages/AlgoPage'
import ReportsPage from '@/pages/ReportsPage'
import AccountsPage from '@/pages/AccountsPage'
import DashboardPage from '@/pages/DashboardPage'
import IndicatorsPage from '@/pages/IndicatorsPage'
import AnalyticsPage from '@/pages/AnalyticsPage'
import AIAgentPage from '@/pages/AIAgentPage'
import { useStore } from '@/store'
import { useEffect } from 'react'
import { accountsAPI } from '@/services/api'

export default function App() {
  // Force dark theme always — LIFEX is dark-only
  document.documentElement.setAttribute('data-theme', 'dark')
  const setAccounts = useStore(s => s.setAccounts)

  // Load accounts on mount
  useEffect(() => {
    accountsAPI.list().then(r => setAccounts(r.data?.accounts || r.data || [])).catch(() => {})
  }, [setAccounts])

  return (
    <BrowserRouter>
      <Routes>
        {/* Landing page */}
        <Route path="/" element={<LandingPage />} />

        {/* App routes — Layout is a pathless wrapper */}
        <Route element={<Layout />}>
          <Route path="/dashboard"  element={<DashboardPage />} />
          <Route path="/grid"       element={<GridPage />} />
          <Route path="/orders"     element={<OrdersPage />} />
          <Route path="/algo/new"   element={<AlgoPage />} />
          <Route path="/algo/:id"   element={<AlgoPage />} />
          <Route path="/reports"    element={<ReportsPage />} />
          <Route path="/accounts"   element={<AccountsPage />} />
          <Route path="/indicators" element={<IndicatorsPage />} />
          <Route path="/analytics"  element={<AnalyticsPage />} />
          <Route path="/ai"         element={<AIAgentPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
