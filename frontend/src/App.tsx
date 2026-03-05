import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from '@/components/layout/Layout'
import LoginPage from '@/pages/LoginPage'
import GridPage from '@/pages/GridPage'
import OrdersPage from '@/pages/OrdersPage'
import AlgoPage from '@/pages/AlgoPage'
import ReportsPage from '@/pages/ReportsPage'
import AccountsPage from '@/pages/AccountsPage'
import DashboardPage from '@/pages/DashboardPage'
import IndicatorsPage from '@/pages/IndicatorsPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Layout />}>
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
      </Routes>
    </BrowserRouter>
  )
}
