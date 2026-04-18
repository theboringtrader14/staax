-- =============================================================================
-- REVERT: Wrongly auto-squared PRACTIX overnight orders — 2026-04-17
-- Root cause: recover_today_jobs() included BTST/STBT and used exit_time (intraday)
-- Run inside docker: docker exec -it staax-db-1 psql -U staax -d staax
-- =============================================================================

-- STEP 0: PREVIEW — verify affected rows before updating
SELECT
    o.id,
    o.symbol,
    o.direction,
    o.status,
    o.exit_reason,
    o.exit_time AT TIME ZONE 'Asia/Kolkata' AS exit_time_ist,
    ge.trading_date AS entry_date
FROM orders o
JOIN grid_entries ge ON ge.id = o.grid_entry_id
WHERE o.is_overnight = true
  AND o.is_practix   = true
  AND o.exit_reason  = 'auto_sq'
  AND o.exit_time AT TIME ZONE 'UTC' BETWEEN '2026-04-17 03:00:00' AND '2026-04-17 05:00:00'
  AND o.symbol NOT LIKE 'SENSEX%'
  AND ge.trading_date = '2026-04-16';

-- =============================================================================
-- If the preview looks correct, run STEP 1–3 below.
-- =============================================================================

-- STEP 1: Revert wrongly closed orders → open
UPDATE orders SET
    status       = 'open',
    exit_price   = NULL,
    exit_time    = NULL,
    exit_reason  = NULL,
    pnl          = NULL
WHERE is_overnight = true
  AND is_practix   = true
  AND exit_reason  = 'auto_sq'
  AND exit_time AT TIME ZONE 'UTC' BETWEEN '2026-04-17 03:00:00' AND '2026-04-17 05:00:00'
  AND symbol NOT LIKE 'SENSEX%'
  AND grid_entry_id IN (
      SELECT id FROM grid_entries WHERE trading_date = '2026-04-16'
  );

-- STEP 2: Revert grid_entries → algo_active
UPDATE grid_entries SET
    status     = 'algo_active',
    updated_at = now()
WHERE id IN (
    SELECT DISTINCT grid_entry_id FROM orders
    WHERE is_overnight  = true
      AND is_practix    = true
      AND status        = 'open'
      AND symbol NOT LIKE 'SENSEX%'
      AND grid_entry_id IN (
          SELECT id FROM grid_entries WHERE trading_date = '2026-04-16'
      )
);

-- STEP 3: Revert algo_states → active
UPDATE algo_states SET
    status        = 'active',
    error_message = NULL,
    error_at      = NULL,
    closed_at     = NULL,
    updated_at    = now()
WHERE trading_date = '2026-04-16'
  AND is_practix  = true
  AND status      = 'closed'
  AND grid_entry_id IN (
      SELECT DISTINCT grid_entry_id FROM orders
      WHERE is_overnight = true
        AND is_practix   = true
        AND status       = 'open'
        AND symbol NOT LIKE 'SENSEX%'
        AND grid_entry_id IN (
            SELECT id FROM grid_entries WHERE trading_date = '2026-04-16'
        )
  );

-- STEP 4: Verify final state
SELECT
    ags.trading_date,
    a.name        AS algo_name,
    ags.status    AS algo_state,
    ge.status     AS grid_status,
    COUNT(o.id)   AS open_orders
FROM algo_states ags
JOIN grid_entries ge ON ge.id = ags.grid_entry_id
JOIN algos a         ON a.id  = ags.algo_id
JOIN orders o        ON o.grid_entry_id = ags.grid_entry_id
WHERE ags.trading_date = '2026-04-16'
  AND ags.is_practix   = true
  AND a.strategy_mode IN ('btst', 'stbt')
  AND o.is_overnight   = true
  AND o.status         = 'open'
GROUP BY 1, 2, 3, 4;
