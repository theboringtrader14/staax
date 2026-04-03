'use client';
import { useState } from 'react';
import styles from './page.module.css';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';

type Tab = 'performance' | 'failures' | 'slippage' | 'latency';
type FY = 'FY 2025-26' | 'FY 2024-25';

const HEATMAP_DATA = [
  { algo: 'Algo-1',     mon: null, tue: '+0.0k', wed: null, thu: null, fri: '-0.0k', total: '-₹29',   totalPos: false },
  { algo: 'Algo-11',   mon: null, tue: null,    wed: null, thu: null, fri: '-0.4k', total: '-₹401',  totalPos: false },
  { algo: 'Algo-17',   mon: null, tue: null,    wed: null, thu: null, fri: '-0.1k', total: '-₹111',  totalPos: false },
  { algo: 'Algo-18',   mon: null, tue: null,    wed: null, thu: null, fri: '+0.0k', total: '+₹20',   totalPos: true  },
  { algo: 'Algo-19',   mon: null, tue: null,    wed: null, thu: null, fri: '-2.1k', total: '-₹2,136',totalPos: false },
  { algo: 'Algo-2',    mon: null, tue: null,    wed: null, thu: null, fri: '+2.6k', total: '+₹2,604',totalPos: true  },
  { algo: 'Algo-3',    mon: null, tue: null,    wed: null, thu: null, fri: '+0.0k', total: '+₹20',   totalPos: true  },
  { algo: 'Test New-2',mon: '+0.0k',tue:null,   wed: null, thu: null, fri: null,   total: '+₹24',   totalPos: true  },
];

function HeatCell({ val }: { val: string | null }) {
  if (!val) return <td className={styles.heatEmpty}>—</td>;
  const pos = val.startsWith('+');
  return (
    <td>
      <span className={`${styles.heatCell} ${pos ? styles.heatPos : styles.heatNeg}`}>
        {val}
      </span>
    </td>
  );
}

export default function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>('performance');
  const [fy, setFy] = useState<FY>('FY 2025-26');

  return (
    <div className={styles.page}>

      {/* Header */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Analytics</h1>
          <p className={styles.pageDesc}>
            Performance, risk, failures & slippage ·{' '}
            <Chip variant="active" className={styles.envChip}>PRACTIX</Chip>
          </p>
        </div>
        <div className={styles.fyToggle}>
          {(['FY 2025-26', 'FY 2024-25'] as FY[]).map((f) => (
            <button
              key={f}
              className={`${styles.fyBtn} ${fy === f ? styles.fyActive : ''}`}
              onClick={() => setFy(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        {(['performance', 'failures', 'slippage', 'latency'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'performance' && (
        <>
          {/* Hero metric cards */}
          <div className={styles.heroCards}>
            <GlassCard cloud className={`${styles.heroCard} ${styles.heroPos}`}>
              <div className={styles.heroLabel}>Best Algo</div>
              <div className={styles.heroValue} style={{ color: 'var(--sem-long)' }}>Algo-2</div>
              <div className={styles.heroSub}>+₹2,604 · 2W/0L</div>
            </GlassCard>
            <GlassCard cloud className={`${styles.heroCard} ${styles.heroNeg}`}>
              <div className={styles.heroLabel}>Worst Algo</div>
              <div className={styles.heroValue} style={{ color: 'var(--sem-short)' }}>Algo-19</div>
              <div className={styles.heroSub}>−₹2,136 · 0W/2L</div>
            </GlassCard>
            <GlassCard cloud className={styles.heroCard}>
              <div className={styles.heroLabel}>Best Score</div>
              <div className={styles.heroValue}>65.2</div>
              <div className={styles.heroSub}>Algo-2 · B</div>
            </GlassCard>
            <GlassCard cloud className={styles.heroCard}>
              <div className={styles.heroLabel}>Avg Score</div>
              <div className={styles.heroValue}>23.8</div>
              <div className={styles.heroSub}>All algos</div>
            </GlassCard>
            <GlassCard cloud className={styles.heroCard}>
              <div className={styles.heroLabel}>Most Consistent</div>
              <div className={styles.heroValue} style={{ color: 'var(--sem-signal)' }}>Algo-1</div>
              <div className={styles.heroSub}>4 trades</div>
            </GlassCard>
            <GlassCard cloud className={`${styles.heroCard} ${styles.heroNeg}`}>
              <div className={styles.heroLabel}>Needs Attention</div>
              <div className={styles.heroValue} style={{ color: 'var(--sem-short)' }}>Algo-11</div>
              <div className={styles.heroSub}>Score 5 · D</div>
            </GlassCard>
          </div>

          {/* Heatmap / Health toggle */}
          <GlassCard cloud noPad className={styles.heatmapCard}>
            <div className={styles.heatmapHeader}>
              <div className={styles.heatSubTabs}>
                <button className={`${styles.subTab} ${styles.subTabActive}`}>P&L Heatmap</button>
                <button className={styles.subTab}>Health Scores</button>
              </div>
            </div>

            <div className={styles.tableWrapper}>
              <table className={styles.heatTable}>
                <thead>
                  <tr>
                    <th>Algo</th>
                    <th>Mon</th>
                    <th>Tue</th>
                    <th>Wed</th>
                    <th>Thu</th>
                    <th>Fri</th>
                    <th style={{ textAlign: 'right' }}>FY Total</th>
                  </tr>
                </thead>
                <tbody>
                  {HEATMAP_DATA.map((row) => (
                    <tr key={row.algo}>
                      <td className={styles.algoCell}>{row.algo}</td>
                      <HeatCell val={row.mon} />
                      <HeatCell val={row.tue} />
                      <HeatCell val={row.wed} />
                      <HeatCell val={row.thu} />
                      <HeatCell val={row.fri} />
                      <td style={{ textAlign: 'right' }}>
                        <span className={row.totalPos ? styles.totalPos : styles.totalNeg}>
                          {row.total}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassCard>

          {/* Best time to trade */}
          <GlassCard cloud className={styles.bestTimeCard}>
            <div className={styles.sectionLabel}>Best Time to Trade</div>
            <div className={styles.barChart}>
              {[
                { time: '9AM',  pnl: 2600,  pct: 42.9, pos: true  },
                { time: '10AM', pnl: 0,     pct: 0,    pos: true  },
                { time: '11AM', pnl: -2200, pct: 0,    pos: false },
                { time: '12PM', pnl: 0,     pct: 0,    pos: true  },
                { time: '1PM',  pnl: 24,    pct: 50,   pos: true  },
              ].map((b) => (
                <div key={b.time} className={styles.barCol}>
                  {b.pnl !== 0 && (
                    <>
                      <div className={styles.barLabel}>
                        {b.pos ? `+${(b.pnl/1000).toFixed(1)}k` : `${(b.pnl/1000).toFixed(1)}k`}
                      </div>
                      <div
                        className={`${styles.bar} ${b.pos ? styles.barPos : styles.barNeg}`}
                        style={{ height: `${Math.min(Math.abs(b.pnl) / 30, 100)}px` }}
                      />
                    </>
                  )}
                  {b.pnl === 0 && <div className={styles.barDash}>—</div>}
                  <div className={styles.barTime}>{b.time}</div>
                  <div className={styles.barPct}>{b.pct > 0 ? `${b.pct}%` : '—'}</div>
                </div>
              ))}
            </div>
            <div className={styles.chartLegend}>
              <span className={styles.legendPos}>■ Profit</span>
              <span className={styles.legendNeg}>■ Loss</span>
              <span style={{ color: 'var(--gs-light)', fontSize: '11px' }}>% = win rate · hover for details</span>
            </div>
          </GlassCard>
        </>
      )}

      {(tab === 'failures' || tab === 'slippage' || tab === 'latency') && (
        <GlassCard cloud className={styles.emptyTab}>
          <div className={styles.emptyTabTitle}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)} Analytics
          </div>
          <p className={styles.emptyTabDesc}>Select a date range to view {tab} data.</p>
        </GlassCard>
      )}

    </div>
  );
}
