import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { CheckCircle, XCircle } from '@phosphor-icons/react'
import { Toaster } from 'sonner'
import Layout from '@/components/layout/Layout'
import LandingPage from '@/pages/LandingPage'
import GridPage from '@/pages/GridPage'
import OrdersPage from '@/pages/OrdersPage'
import AlgoPage from '@/pages/AlgoPage'
import ReportsPage from '@/pages/ReportsPage'
import IndicatorsPage from '@/pages/IndicatorsPage'
import AnalyticsPage from '@/pages/AnalyticsPage'
import { useStore } from '@/store'
import { useEffect, useState } from 'react'
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

  // Resume AudioContext on first user interaction (browsers block autoplay)
  useEffect(() => {
    const init = () => { initSounds(); document.removeEventListener('click', init) }
    document.addEventListener('click', init)
    return () => document.removeEventListener('click', init)
  }, [])

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
            <CheckCircle size={52} weight="fill" color="#0ea66e" />
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
            <XCircle size={52} weight="fill" color="#FF4444" />
            <p style={{color: '#FF4444', fontFamily: 'Syne', fontWeight: 700, fontSize: 18}}>Connection Failed</p>
            <button onClick={() => window.close()} style={{marginTop: 8, padding: '8px 20px', borderRadius: 8, border: '0.5px solid rgba(255,68,68,0.4)', background: 'transparent', color: '#FF4444', fontFamily: 'Syne', cursor: 'pointer'}}>Close</button>
          </>
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  return (
    <>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '12px',
            background: '#1a2520',
            border: '1px solid rgba(45,212,191,0.25)',
            color: '#e2e8f0',
            borderRadius: '8px',
          },
          duration: 4000,
        }}
      />
      <BrowserRouter>
        <DashboardPanel />
        <AccountsDrawer />
        <Routes>
          {/* Landing page */}
          <Route path="/" element={<LandingPage />} />

          {/* App routes — Layout is a pathless wrapper */}
          <Route element={<Layout />}>
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
