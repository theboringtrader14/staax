'use client';
import styles from './page.module.css';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { MetricCard } from '@/components/ui/MetricCard';
import { Chip, PulseDot } from '@/components/ui/Chip';
import { SystemLog, LogEntry } from '@/components/dashboard/SystemLog';
import { ServiceRow } from '@/components/dashboard/ServiceRow';
import { SystemStatusBanner } from '@/components/dashboard/SystemStatusBanner';

// ── Sample data (replace with real API calls) ──────────────────────────────
const STATUS_CHECKS = [
  { label: 'Database connected  11ms', ok: true },
  { label: 'Redis running  3ms',       ok: true },
  { label: 'Karthik AO token valid',   ok: false },
  { label: 'Mom AO token valid',       ok: true },
  { label: 'Wife AO token valid',      ok: false },
  { label: 'Zerodha token valid',      ok: false },
  { label: 'Market Feed connected',    ok: false },
  { label: 'Scheduler running',        ok: true },
];

const LOG_ENTRIES: LogEntry[] = [
  { time: '22:36:36', type: 'ok',      message: '[auth] Angel One (Mom) connected' },
  { time: '20:16:12', type: 'ok',      message: '[auth] Angel One (Mom) connected' },
  { time: '10:05:00', type: 'neutral', message: '[scheduler] Entry fired: Algo-9' },
  { time: '09:54:00', type: 'ok',      message: '[engine] Algo-8 · BUY NIFTY07APR2622350CE OPEN @ 397.00' },
  { time: '09:45:01', type: 'ok',      message: '[engine] Algo-1 · SELL NIFTY07APR2622350PE OPEN @ 382.20' },
  { time: '09:45:00', type: 'error',   message: '[engine] Leg 1 failed: Strike selection failed for leg 1: NIFTY CE atm' },
  { time: '08:30:15', type: 'ok',      message: '[auth] Angel One (Karthik AO) connected' },
];

const HOLIDAYS = [
  { date: '14 Apr · Tue', name: 'Dr. Baba Saheb Ambedkar Jayanti' },
  { date: '01 May · Fri', name: 'Maharashtra Day' },
];

const ACCOUNTS = [
  { name: 'Karthik',    broker: 'Zerodha' },
  { name: 'Mom',        broker: 'Angel One' },
  { name: 'Wife',       broker: 'Angel One' },
  { name: 'Karthik AO', broker: 'Angel One' },
];

// ─────────────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  return (
    <div className={styles.page}>

      {/* Page header */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Dashboard</h1>
          <p className={styles.pageDesc}>
            System status · Start / stop services ·{' '}
            <Chip variant="active" className={styles.envChip}>PRACTIX</Chip>
          </p>
        </div>
        <div className={styles.pageActions}>
          <Button variant="danger">⚡ Kill Switch</Button>
          <Button variant="steel">⛔ Stop All</Button>
          <Button variant="primary">▶ Start Session</Button>
        </div>
      </div>

      {/* System health */}
      <SystemStatusBanner
        ready={false}
        time="09:06:34 am"
        checks={STATUS_CHECKS}
        onRefresh={() => {}}
      />

      {/* Metric cards */}
      <div className={`${styles.metricsRow} ${styles.animGrid}`}>
        <MetricCard
          label="Active Algos"
          value="0"
          sub="of 0 algos"
          sparkline={[10, 30, 20, 60, 45, 80, 65]}
        />
        <MetricCard
          label="Open Positions"
          value="0"
          sub="open lots"
        />
        <MetricCard
          label="Today P&L"
          value={<span style={{ color: 'var(--ox-radiant)' }}>+₹0</span>}
          sub={<span className="delta-pos">▲ Profit</span>}
          sparkline={[5, 15, 12, 40, 35, 60, 55]}
        />
        <MetricCard
          label="FY P&L"
          value={<span style={{ color: 'var(--ox-radiant)' }}>+₹0</span>}
          sub={<span className="delta-pos">▲ Profit</span>}
        />
      </div>

      {/* Next Algo + Holidays */}
      <div className={`${styles.midRow} ${styles.sectionGap}`}>
        <GlassCard cloud className={styles.nextAlgo}>
          <div className={styles.panelLabel}>
            <PulseDot type="warn" />
            Next Algo
          </div>
          <p className={styles.emptyState}>No algos scheduled today</p>
        </GlassCard>

        <GlassCard cloud className={styles.holidays}>
          <div className={styles.panelLabelRow}>
            <div className={styles.panelLabel}>Upcoming Holidays (F&O)</div>
            <Button variant="steel" size="sm">Sync NSE</Button>
          </div>
          <div className={styles.holidayList}>
            {HOLIDAYS.map((h) => (
              <div key={h.date} className={styles.holidayCard}>
                <div className={styles.holidayDate}>{h.date}</div>
                <div className={styles.holidayName}>{h.name}</div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* Trades + Services + Log */}
      <div className={`${styles.triRow} ${styles.sectionGap}`}>
        {/* Recent Trades */}
        <GlassCard cloud noPad className={styles.tradesPanel}>
          <div className={styles.panelHeader}>
            <PulseDot type="live" />
            <span className={styles.panelHeaderTitle}>Recent Trades · Today</span>
          </div>
          <div className={styles.tradesBody}>
            <p className={styles.emptyState}>No completed trades today</p>
          </div>
        </GlassCard>

        {/* Services */}
        <GlassCard cloud noPad className={styles.servicesPanel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelHeaderTitle}>Services</span>
          </div>
          <div className={styles.servicesBody}>
            <ServiceRow name="PostgreSQL"  host="localhost:5432" status="stopped" />
            <ServiceRow name="Redis"       host="localhost:6379" status="stopped" />
            <ServiceRow name="Backend API" host="localhost:8000" status="running" />
            <ServiceRow name="Market Feed" host="NSE live tick data" status="running" />
            <ServiceRow
              name="Zerodha Token"
              host="⚠️ Login required"
              status="error"
              isLogin
              loginLabel="Login"
            />
          </div>
        </GlassCard>

        {/* System Log */}
        <SystemLog entries={LOG_ENTRIES} />
      </div>

      {/* Account Status */}
      <div className={styles.sectionGap}>
        <GlassCard cloud noPad>
          <div className={styles.panelHeader}>
            <span className={styles.panelHeaderTitle}>Account Status</span>
          </div>
          <div className={styles.accountGrid}>
            {ACCOUNTS.map((acc) => (
              <div key={acc.name} className={styles.accountCard}>
                <div className={styles.accountAvatar}>
                  {acc.name.slice(0, 2).toUpperCase()}
                </div>
                <div className={styles.accountInfo}>
                  <div className={styles.accountName}>{acc.name}</div>
                  <div className={styles.accountBroker}>{acc.broker}</div>
                </div>
                <Button variant="ghost" size="sm">🔑 Login</Button>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

    </div>
  );
}
