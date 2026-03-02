// ── Enums ────────────────────────────────────────────────────────────────────
export type StrategyMode  = 'intraday' | 'btst' | 'stbt' | 'positional'
export type EntryType     = 'direct' | 'orb' | 'wt' | 'orb_wt'
export type OrderStatus   = 'pending' | 'open' | 'closed' | 'error'
export type GridStatus    = 'no_trade' | 'algo_active' | 'order_pending' | 'open' | 'algo_closed' | 'error'
export type BrokerType    = 'zerodha' | 'angelone'
export type AccountStatus = 'active' | 'token_expired' | 'disconnected'

// ── Accounts ─────────────────────────────────────────────────────────────────
export interface Account {
  id: string
  nickname: string
  broker: BrokerType
  client_id: string
  status: AccountStatus
  global_sl?: number
  global_tp?: number
}

// ── Algo ─────────────────────────────────────────────────────────────────────
export interface AlgoLeg {
  id: string
  leg_number: number          // 1, 2 — parent
  direction: 'buy' | 'sell'
  instrument: 'ce' | 'pe' | 'fu'
  underlying: string
  expiry: string
  strike_type: string
  strike_offset: number
  lots: number
  sl_type?: string
  sl_value?: number
  tp_type?: string
  tp_value?: number
  tsl_x?: number
  tsl_y?: number
  tsl_unit?: string
}

export interface Algo {
  id: string
  name: string
  account_id: string
  strategy_mode: StrategyMode
  entry_type: EntryType
  entry_time?: string
  exit_time?: string
  orb_start_time?: string
  orb_end_time?: string
  next_day_exit_time?: string
  next_day_sl_check_time?: string
  mtm_sl?: number
  mtm_tp?: number
  is_active: boolean
  legs: AlgoLeg[]
}

// ── Grid ─────────────────────────────────────────────────────────────────────
export interface GridEntry {
  id: string
  algo_id: string
  algo_name: string
  account_id: string
  trading_date: string
  day_of_week: string
  lot_multiplier: number
  is_enabled: boolean
  status: GridStatus
  is_practix: boolean
  entry_time?: string
  next_day_sl_check_time?: string
}

export interface WeekGrid {
  week_start: string
  days: { [day: string]: GridEntry[] }
}

// ── Orders ────────────────────────────────────────────────────────────────────
export interface Order {
  id: string
  algo_id: string
  algo_name: string
  account_nickname: string
  symbol: string
  direction: 'buy' | 'sell'
  lots: number
  quantity: number
  entry_type?: string
  entry_reference?: string
  fill_price?: number
  fill_time?: string
  ltp?: number
  sl_original?: number
  sl_actual?: number
  target?: number
  exit_price?: number
  exit_time?: string
  exit_reason?: string
  pnl?: number
  status: OrderStatus
  journey_level?: string
  is_practix: boolean
  error_message?: string
}
