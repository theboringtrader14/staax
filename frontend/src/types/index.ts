// ── Enums ────────────────────────────────────────────────────────────────────
export type StrategyMode  = 'intraday' | 'btst' | 'stbt' | 'positional'
export type EntryType     = 'direct' | 'orb'                    // WT removed — per-leg only
export type OrderStatus   = 'pending' | 'open' | 'closed' | 'error'
export type GridStatus    = 'no_trade' | 'algo_active' | 'order_pending' | 'open' | 'algo_closed' | 'error'
export type BrokerType    = 'zerodha' | 'angelone'
export type AccountStatus = 'active' | 'token_expired' | 'disconnected'
export type AlgoRunStatus = 'inactive' | 'waiting' | 'active' | 'closed' | 'error' | 'terminated' | 'no_trade'
export type ReentryMode   = 'at_entry_price' | 'immediate' | 'at_cost'
export type SLTPType      = 'pts_instrument' | 'pct_instrument' | 'pts_underlying' | 'pct_underlying'


// ── Accounts ─────────────────────────────────────────────────────────────────
export interface Account {
  id:        string
  nickname:  string
  broker:    BrokerType
  client_id: string
  status:    AccountStatus
  global_sl?: number
  global_tp?: number
}


// ── Algo ─────────────────────────────────────────────────────────────────────
export interface AlgoLeg {
  id:            string
  leg_number:    number
  direction:     'buy' | 'sell'
  instrument:    'ce' | 'pe' | 'fu'
  underlying:    string
  expiry:        string
  strike_type:   string
  strike_offset: number
  strike_value?: number
  lots:          number

  // SL / TP
  sl_type?:  SLTPType
  sl_value?: number
  tp_type?:  SLTPType
  tp_value?: number

  // TSL
  tsl_x?:    number
  tsl_y?:    number
  tsl_unit?: 'pts' | 'pct'

  // W&T (per-leg — NOT at algo level)
  wt_enabled:    boolean
  wt_direction?: 'up' | 'down'
  wt_value?:     number
  wt_unit?:      'pts' | 'pct'

  // Re-entry (per-leg — NOT at algo level)
  reentry_enabled: boolean
  reentry_mode?:   ReentryMode
  reentry_max:     number   // 0–5
}

export interface Algo {
  id:           string
  name:         string
  account_id:   string
  strategy_mode: StrategyMode
  entry_type:   EntryType    // 'direct' | 'orb' only
  order_type:   'market' | 'limit'
  is_active:    boolean

  // Timing
  entry_time?:         string   // HH:MM
  exit_time?:          string   // HH:MM
  orb_start_time?:     string   // HH:MM — ORB only
  orb_end_time?:       string   // HH:MM — ORB only
  next_day_exit_time?: string   // HH:MM — BTST/STBT only
  // NOTE: next_day_sl_check_time is NOT stored — computed as entry_time - 2min

  // Positional
  dte?: number   // 1–30. undefined = exit on expiry day.

  // MTM
  mtm_sl?:   number
  mtm_tp?:   number
  mtm_unit?: 'amt' | 'pct'

  base_lot_multiplier: number
  legs: AlgoLeg[]
}


// ── AlgoState ─────────────────────────────────────────────────────────────────
export interface AlgoState {
  id:            string
  grid_entry_id: string
  algo_id:       string
  account_id:    string
  trading_date:  string
  status:        AlgoRunStatus
  is_practix:    boolean
  mtm_current:   number
  mtm_realised:  number
  reentry_count: number
  journey_level?: string
  exit_reason?:  string
  error_message?: string
}


// ── Grid ─────────────────────────────────────────────────────────────────────
export interface GridEntry {
  id:             string
  algo_id:        string
  algo_name:      string
  account_id:     string
  trading_date:   string
  day_of_week:    string
  lot_multiplier: number
  is_enabled:     boolean
  is_practix:     boolean
  is_archived:    boolean   // hidden from active grid, recoverable
  status:         GridStatus
}

export interface WeekGrid {
  week_start: string
  days: { [day: string]: GridEntry[] }
}


// ── Orders ────────────────────────────────────────────────────────────────────
export interface Order {
  id:            string
  algo_id:       string
  algo_name:     string
  account_nickname: string
  symbol:        string
  exchange:      string
  direction:     'buy' | 'sell'
  lots:          number
  quantity:      number
  is_practix:    boolean
  is_overnight:  boolean    // BTST/STBT orders use NRML product type

  // Entry
  entry_type?:      string
  entry_reference?: string
  fill_price?:      number
  fill_time?:       string

  // Live
  ltp?:        number
  sl_original?: number
  sl_actual?:  number
  target?:     number

  // Exit
  exit_price?:  number
  exit_time?:   string
  exit_reason?: string
  pnl?:         number

  // State
  status:         OrderStatus
  journey_level?: string
  error_message?: string
}


// ── Reports ───────────────────────────────────────────────────────────────────
export interface TradeRecord {
  id:             string
  order_id:       string
  account_id:     string
  algo_id:        string
  algo_name:      string
  trading_date:   string
  financial_year: string
  realised_pnl:   number
  exit_reason?:   string
  journey_level?: string
  is_practix:     boolean
}

export interface AlgoMetrics {
  algo_id:     string
  algo_name:   string
  total_pnl:   number
  avg_day_pnl: number
  max_profit:  number
  max_loss:    number
  win_pct:     number
  loss_pct:    number
  max_drawdown: number
  roi:         number
  trade_count: number
}
