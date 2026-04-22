export const ORDER_STATUS = {
  OPEN:      'open',
  CLOSED:    'closed',
  MISSED:    'missed',
  ERROR:     'error',
  CANCELLED: 'cancelled',
} as const

export function formatExitReason(reason: string | null | undefined): string {
  if (!reason) return '—'
  const map: Record<string, string> = {
    sl: 'SL Hit', tsl: 'TSL Hit', tp: 'TP Hit', ttp: 'TTP Hit',
    mtm_sl: 'MTM SL', mtm_tp: 'MTM TP', auto_sq: 'Exit Time',
    sq: 'SQ', manual: 'Manual', terminate: 'Terminate',
    expiry: 'Expiry', reconcile: 'Reconcile',
    btst_exit: 'BTST Exit', stbt_exit: 'STBT Exit',
    global_sl: 'Global SL', expiry_force_close: 'Expiry', kill_switch: 'Kill Switch',
    error: 'Error', terminated: 'Terminate',
  }
  return map[reason] ?? reason
}

export function formatOrderStatus(status: string | null | undefined): string {
  if (!status) return '—'
  return status.toUpperCase()
}
