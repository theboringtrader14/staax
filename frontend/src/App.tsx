import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import ZerodhaCallbackPage from './pages/ZerodhaCallbackPage'
import Layout from '@/components/layout/Layout'
import LoginPage from '@/pages/LoginPage'
import GridPage from '@/pages/GridPage'
import OrdersPage from '@/pages/OrdersPage'
import AlgoPage from '@/pages/AlgoPage'
import ReportsPage from '@/pages/ReportsPage'
import AccountsPage from '@/pages/AccountsPage'
import DashboardPage from '@/pages/DashboardPage'
import IndicatorsPage from '@/pages/IndicatorsPage'
import { useStore } from '@/store'

/** Redirect unauthenticated users to /login */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useStore(s => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  // Apply saved theme on mount
  const theme = localStorage.getItem('staax_theme') || 'dark'
  document.documentElement.setAttribute('data-theme', theme)

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard"  element={<DashboardPage />} />
          <Route path="grid"       element={<GridPage />} />
          <Route path="orders"     element={<OrdersPage />} />
          <Route path="algo/new"   element={<AlgoPage />} />
          <Route path="algo/:id"   element={<AlgoPage />} />
          <Route path="reports"    element={<ReportsPage />} />
          <Route path="accounts"   element={<AccountsPage />} />
          <Route path="indicators" element={<IndicatorsPage />} />
        </Route>
        <Route path="/zerodha-callback" element={<ZerodhaCallbackPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
