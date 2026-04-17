import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import HoneycombBackground from '@/components/HoneycombBackground'
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
import { useStore } from '@/store'
import { useEffect, useState } from 'react'
import { accountsAPI } from '@/services/api'

export default function App() {
  // Force dark theme always — LIFEX is dark-only
  document.documentElement.setAttribute('data-theme', 'dark')
  const setAccounts = useStore(s => s.setAccounts)

  // Global Zerodha OAuth popup handler
  const [zerodhaStatus, setZerodhaStatus] = useState<'connecting' | 'success' | 'error' | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requestToken = params.get('request_token')

    if (requestToken && window.opener) {
      setZerodhaStatus('connecting')
      const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'
      fetch(`${API_BASE}/api/v1/accounts/zerodha/callback?request_token=${encodeURIComponent(requestToken)}`)
        .then(res => {
          if (res.ok) {
            setZerodhaStatus('success')
            try { window.opener.location.reload() } catch (_) {}
            // Try multiple close methods
            setTimeout(() => {
              try { window.close() } catch (_) {}
              try { window.open('', '_self')?.close() } catch (_) {}
            }, 2000)
          } else {
            setZerodhaStatus('error')
          }
        })
        .catch(() => setZerodhaStatus('error'))
    }
  }, [])

  // Load accounts on mount
  useEffect(() => {
    accountsAPI.list().then(r => setAccounts(r.data?.accounts || r.data || [])).catch(() => {})
  }, [setAccounts])

  // Render overlay in popup mode — prevents LandingPage from flashing
  if (zerodhaStatus) {
    return (
      <div style={{
        position: 'fixed', inset: 0,
        background: '#0f0f12',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 16
      }}>
        {zerodhaStatus === 'connecting' && (
          <>
            <div style={{width: 40, height: 40, border: '3px solid rgba(255,107,0,0.2)', borderTopColor: '#FF6B00', borderRadius: '50%', animation: 'spin 0.8s linear infinite'}} />
            <p style={{color: 'rgba(232,232,248,0.6)', fontFamily: 'Syne', fontSize: 14}}>Connecting Zerodha...</p>
          </>
        )}
        {zerodhaStatus === 'success' && (
          <>
            <div style={{fontSize: 52}}>✅</div>
            <p style={{color: '#22DD88', fontFamily: 'Syne', fontWeight: 700, fontSize: 18}}>Zerodha Connected</p>
            <p style={{color: 'rgba(232,232,248,0.4)', fontFamily: 'Syne', fontSize: 13}}>Closing window...</p>
            <button
              onClick={() => window.close()}
              style={{
                marginTop: 8, padding: '6px 16px', borderRadius: 8,
                border: '0.5px solid rgba(34,221,136,0.4)',
                background: 'transparent', color: '#22DD88',
                fontFamily: 'Syne', fontSize: 12, cursor: 'pointer'
              }}
            >Close Window</button>
          </>
        )}
        {zerodhaStatus === 'error' && (
          <>
            <div style={{fontSize: 52}}>❌</div>
            <p style={{color: '#FF4444', fontFamily: 'Syne', fontWeight: 700, fontSize: 18}}>Connection Failed</p>
            <button onClick={() => window.close()} style={{marginTop: 8, padding: '8px 20px', borderRadius: 8, border: '0.5px solid rgba(255,68,68,0.4)', background: 'transparent', color: '#FF4444', fontFamily: 'Syne', cursor: 'pointer'}}>Close</button>
          </>
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <HoneycombBackground />
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
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
