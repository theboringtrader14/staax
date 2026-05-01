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

/** WebSocket message shape — genuinely dynamic (boundary unknown after JSON.parse) */
type WsMessage = Record<string, unknown>

function makeWs(
  path: string,
  onMessage: (data: WsMessage) => void,
  retryRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
) {
  let ws: WebSocket

  const connect = () => {
    try {
      ws = new WebSocket(`${WS_BASE}${path}`)

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as WsMessage
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
    // Helper to safely extract string fields from unknown WS record
    const str = (v: unknown): string => (typeof v === 'string' ? v : '')
    const rec = (v: unknown): WsMessage => (v && typeof v === 'object' ? v as WsMessage : {})

    const pnlWs = makeWs('/ws/pnl', (msg) => {
      if (msg['type'] === 'total_pnl') {
        const data = rec(msg['data'])
        const pnl = data['total_pnl']
        if (typeof pnl === 'number') setLivePnl(pnl)
      }
    }, pnlRetry)

    // /ws/status — algo state + order updates
    const statusWs = makeWs('/ws/status', (msg) => {
      const data = rec(msg['data'])
      if (msg['type'] === 'order_update' && data['order_id']) {
        updateOrder(str(data['order_id']), data as Partial<import('@/types').Order>)
      }
      if (msg['type'] === 'sl_hit' && msg['data']) {
        showError(`SL Hit: ${str(data['symbol'])} at ₹${str(data['sl_price'])}`, 6000)
        sounds.slHit()
      }
    }, statusRetry)

    // /ws/notifications — notification panel
    const notifWs = makeWs('/ws/notifications', (msg) => {
      if (msg['type'] === 'notification' && msg['data']) {
        const data = rec(msg['data'])
        addNotification({
          type: str(data['level']) as 'info' | 'warn' | 'error' | 'success',
          msg:  str(data['msg']),
          time: str(data['time']),
        })
      }
    }, notifRetry)

    // /ws/system — engine log events: errors and order events become toasts
    const systemWs = makeWs('/ws/system', (msg) => {
      const data = rec(msg['data'])
      const fullMessage: string =
        str(msg['message']) || str(msg['msg']) || str(data['message']) || JSON.stringify(msg)
      const rawText = (str(msg['message']) || str(msg['msg'])).toLowerCase()
      const msgType = str(msg['type'])
      const msgLevel = str(msg['level'])

      const ERROR_KEYWORDS = ['exception', 'traceback', 'failed', 'crash']
      const isError =
        msgType === 'error' ||
        msgLevel === 'error' ||
        msgLevel === 'ERROR' ||
        ERROR_KEYWORDS.some(kw => rawText.includes(kw))

      const ORDER_TYPES = ['order_placed', 'sl_hit', 'target_hit', 'order_event']
      const isWarning =
        ORDER_TYPES.includes(msgType) ||
        msgLevel === 'warning' ||
        msgLevel === 'WARNING'

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
        showWarning(`${labelFor(msgType)}: ${fullMessage}`)
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
