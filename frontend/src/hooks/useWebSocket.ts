/**
 * useWebSocket — connects to all four WebSocket channels.
 * Runs once on app mount (inside Layout.tsx).
 *
 * Channels:
 *   /ws/pnl           → updates store.livePnl on every tick
 *   /ws/status        → updates store.orders via store.updateOrder
 *   /ws/notifications → pushes to store.notifications (bell panel)
 *   /ws/system        → engine log events; surfaces errors/warnings as toasts
 *
 * Reconnects automatically on disconnect (5 second backoff).
 * No-ops if backend is unreachable — app stays functional with demo data.
 */
import { useEffect, useRef } from 'react'
import { useStore } from '@/store'
import { showError, showWarning } from '@/utils/toast'
import { sounds } from '@/utils/sounds'

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
  const systemRetry = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      if (msg.type === 'sl_hit' && msg.data) {
        const d = msg.data
        showError(`SL Hit: ${d.symbol} at ₹${d.sl_price}`, 6000)
        sounds.slHit()
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

    // /ws/system — engine log events: errors and order events become toasts
    const systemWs = makeWs('/ws/system', (msg) => {
      const fullMessage: string =
        msg.message || msg.msg || msg.data?.message || JSON.stringify(msg)
      const rawText = (msg.message || msg.msg || '').toLowerCase()

      const ERROR_KEYWORDS = ['exception', 'traceback', 'failed', 'crash']
      const isError =
        msg.type === 'error' ||
        msg.level === 'error' ||
        msg.level === 'ERROR' ||
        ERROR_KEYWORDS.some(kw => rawText.includes(kw))

      const ORDER_TYPES = ['order_placed', 'sl_hit', 'target_hit', 'order_event']
      const isWarning =
        ORDER_TYPES.includes(msg.type) ||
        msg.level === 'warning' ||
        msg.level === 'WARNING'

      const labelFor = (type: string): string => {
        const MAP: Record<string, string> = {
          order_placed: 'Order Placed',
          sl_hit:       'Stop Loss Hit',
          target_hit:   'Target Hit',
          order_event:  'Order Event',
        }
        return MAP[type] ?? 'System Warning'
      }

      if (isError) {
        showError(fullMessage)
        addNotification({ type: 'error', msg: fullMessage, time: new Date().toISOString() })
      } else if (isWarning) {
        showWarning(`${labelFor(msg.type)}: ${fullMessage}`)
        addNotification({ type: 'warn', msg: fullMessage, time: new Date().toISOString() })
      } else {
        // Silent — store only, no toast
        addNotification({ type: 'info', msg: fullMessage, time: new Date().toISOString() })
      }
    }, systemRetry)

    return () => {
      pnlWs.close()
      statusWs.close()
      notifWs.close()
      systemWs.close()
    }
  }, [isAuthenticated])
}
