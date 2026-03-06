/**
 * useWebSocket — connects to all three WebSocket channels.
 * Runs once on app mount (inside Layout.tsx).
 *
 * Channels:
 *   /ws/pnl           → updates store.livePnl on every tick
 *   /ws/status        → updates store.orders via store.updateOrder
 *   /ws/notifications → pushes to store.notifications (bell panel)
 *
 * Reconnects automatically on disconnect (5 second backoff).
 * No-ops if backend is unreachable — app stays functional with demo data.
 */
import { useEffect, useRef } from 'react'
import { useStore } from '@/store'

const WS_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000')
  .replace('http', 'ws')

function makeWs(
  path: string,
  onMessage: (data: any) => void,
  retryRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
) {
  let ws: WebSocket

  const connect = () => {
    try {
      ws = new WebSocket(`${WS_BASE}${path}`)

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          onMessage(msg)
        } catch {
          // ignore malformed messages
        }
      }

      ws.onclose = () => {
        // Retry after 5 seconds
        retryRef.current = setTimeout(connect, 5000)
      }

      ws.onerror = () => {
        ws.close()
      }
    } catch {
      retryRef.current = setTimeout(connect, 5000)
    }
  }

  connect()

  return {
    close: () => {
      if (retryRef.current) clearTimeout(retryRef.current)
      ws?.close()
    }
  }
}

export function useWebSocket() {
  const setLivePnl     = useStore(s => s.setLivePnl)
  const updateOrder    = useStore(s => s.updateOrder)
  const addNotification = useStore(s => s.addNotification)
  const isAuthenticated = useStore(s => s.isAuthenticated)

  const pnlRetry    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusRetry = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notifRetry  = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!isAuthenticated) return

    // /ws/pnl — live P&L updates
    const pnlWs = makeWs('/ws/pnl', (msg) => {
      if (msg.type === 'total_pnl') {
        setLivePnl(msg.data.total_pnl)
      }
    }, pnlRetry)

    // /ws/status — algo state + order updates
    const statusWs = makeWs('/ws/status', (msg) => {
      if (msg.type === 'order_update' && msg.data?.order_id) {
        updateOrder(msg.data.order_id, msg.data)
      }
    }, statusRetry)

    // /ws/notifications — notification panel
    const notifWs = makeWs('/ws/notifications', (msg) => {
      if (msg.type === 'notification' && msg.data) {
        addNotification({
          type: msg.data.level,
          msg:  msg.data.msg,
          time: msg.data.time,
        })
      }
    }, notifRetry)

    return () => {
      pnlWs.close()
      statusWs.close()
      notifWs.close()
    }
  }, [isAuthenticated])
}
