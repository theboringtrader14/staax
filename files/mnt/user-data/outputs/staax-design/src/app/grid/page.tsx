'use client';
import styles from './page.module.css';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Chip, StatusLabel } from '@/components/ui/Chip';

type AlgoStatus = 'active' | 'closed' | 'waiting' | 'pending' | 'error' | 'notrade';

interface AlgoSlot {
  status: AlgoStatus;
  maxLegs?: number;
  entry?: string;
  exit?: string;
}

interface AlgoRow {
  name: string;
  account: string;
  tags: { label: string; variant: 'orange' | 'signal' | 'success' | 'warn' }[];
  slots: (AlgoSlot | null)[];  // null = no data for that day
}

const DAYS = [
  { label: 'MON', date: '30-03' },
  { label: 'TUE', date: '31-03', holiday: true },
  { label: 'WED', date: '01-04' },
  { label: 'THU', date: '02-04' },
  { label: 'FRI', date: '03-04', holiday: true },
];

const ALGOS: AlgoRow[] = [
  {
    name: 'Algo-1', account: 'Karthik AO (Angelone)',
    tags: [{ label: 'NFS', variant: 'orange' }, { label: 'NFS', variant: 'orange' }],
    slots: [
      { status: 'closed', maxLegs: 1, entry: '09:45:00', exit: '15:01:00' },
      { status: 'closed', maxLegs: 1, entry: '09:45:00', exit: '15:01:00' },
      { status: 'notrade', maxLegs: 1, entry: '09:45:00', exit: '15:01:00' },
      { status: 'notrade', maxLegs: 1, entry: '09:45:00', exit: '15:01:00' },
      { status: 'notrade', maxLegs: 1, entry: '09:45:00', exit: '15:01:00' },
    ],
  },
  {
    name: 'Algo-11', account: 'Karthik AO (Angelone)',
    tags: [{ label: 'BNB', variant: 'signal' }],
    slots: [
      { status: 'closed', maxLegs: 1, entry: '09:55:00', exit: '15:01:00' },
      null,
      { status: 'notrade', maxLegs: 1, entry: '09:55:00', exit: '15:01:00' },
      { status: 'notrade', maxLegs: 1, entry: '09:55:00', exit: '15:01:00' },
      { status: 'notrade', maxLegs: 1, entry: '09:55:00', exit: '15:01:00' },
    ],
  },
  {
    name: 'Algo-15', account: 'Karthik AO (Angelone)',
    tags: [{ label: 'NFB', variant: 'orange' }, { label: 'BNB', variant: 'signal' }],
    slots: [
      { status: 'active', maxLegs: 1, entry: '09:58:00', exit: '09:21:00' },
      null,
      { status: 'notrade', maxLegs: 1, entry: '09:58:00', exit: '09:21:00' },
      { status: 'notrade', maxLegs: 1, entry: '09:58:00', exit: '09:21:00' },
      { status: 'notrade', maxLegs: 1, entry: '09:58:00', exit: '09:21:00' },
    ],
  },
  {
    name: 'Algo-18', account: 'Karthik AO (Angelone)',
    tags: [
      { label: 'BNS', variant: 'warn' },
      { label: 'BNS', variant: 'warn' },
      { label: 'BNB', variant: 'signal' },
      { label: 'BNB', variant: 'signal' },
    ],
    slots: [
      { status: 'active', maxLegs: 1, entry: '11:28:00', exit: '14:29:00' },
      null,
      { status: 'notrade', maxLegs: 1, entry: '11:28:00', exit: '14:29:00' },
      { status: 'notrade', maxLegs: 1, entry: '11:28:00', exit: '14:29:00' },
      { status: 'notrade', maxLegs: 1, entry: '11:28:00', exit: '14:29:00' },
    ],
  },
];

function AlgoSlotCell({ slot }: { slot: AlgoSlot | null }) {
  if (!slot) return <div className={styles.slotEmpty}>—</div>;

  return (
    <div className={`${styles.slot} ${styles[`slot_${slot.status}`]}`}>
      <StatusLabel status={slot.status}>
        {slot.status === 'notrade' ? 'No Trade' : slot.status}
      </StatusLabel>
      {slot.maxLegs && (
        <div className={styles.slotMeta}>
          M <span>{slot.maxLegs}</span>
        </div>
      )}
      {slot.entry && (
        <div className={styles.slotTime}>
          E <span className={styles.timeVal}>{slot.entry}</span>
        </div>
      )}
      {slot.exit && (
        <div className={styles.slotTime}>
          X <span>{slot.exit}</span>
        </div>
      )}
    </div>
  );
}

export default function GridPage() {
  return (
    <div className={styles.page}>

      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Smart Grid</h1>
          <p className={styles.pageDesc}>
            Week of 3 Apr 2026 ·{' '}
            <Chip variant="active" className={styles.envChip}>PRACTIX</Chip>
          </p>
        </div>
        <div className={styles.pageActions}>
          <label className={styles.toggle}>
            <input type="checkbox" />
            <span>Show Weekends</span>
          </label>
          <Button variant="steel" size="sm">Name A → Z ▾</Button>
          <Button variant="steel" size="sm">🗄 Archive</Button>
        </div>
      </div>

      {/* Legend */}
      <div className={styles.legend}>
        {(['notrade', 'waiting', 'active', 'pending', 'closed', 'error'] as const).map((s) => (
          <div key={s} className={styles.legendItem}>
            <StatusLabel status={s}>
              {s === 'notrade' ? 'No Trade' : s.charAt(0).toUpperCase() + s.slice(1)}
            </StatusLabel>
          </div>
        ))}
        <div className={styles.legendHint}>drag pie → day to deploy</div>
      </div>

      {/* Grid */}
      <GlassCard cloud noPad className={styles.gridCard}>
        <div className={styles.gridTable}>
          {/* Header row */}
          <div className={styles.algoHeader}>Algo</div>
          {DAYS.map((d) => (
            <div key={d.label} className={`${styles.dayHeader} ${d.holiday ? styles.holidayHeader : ''}`}>
              <div className={styles.dayLabel}>{d.label}</div>
              <div className={styles.dayDate}>{d.date}</div>
              {d.holiday && <div className={styles.holidayBadge}>HOLIDAY</div>}
            </div>
          ))}

          {/* Algo rows */}
          {ALGOS.map((algo) => (
            <>
              {/* Algo info cell */}
              <div key={`${algo.name}-info`} className={styles.algoCell}>
                <div className={styles.algoTop}>
                  <div className={styles.algoIndicator} />
                  <span className={styles.algoName}>{algo.name}</span>
                  <button className={styles.iconBtn} title="Delete">🗑</button>
                  <button className={styles.iconBtn} title="Settings">⚙</button>
                </div>
                <div className={styles.algoAccount}>{algo.account}</div>
                <div className={styles.algoTags}>
                  {algo.tags.map((t, i) => (
                    <Chip key={i} variant={t.variant} className={styles.tagChip}>{t.label}</Chip>
                  ))}
                  <button className={styles.promoteBtn}>Promote</button>
                </div>
              </div>

              {/* Slot cells */}
              {algo.slots.map((slot, i) => (
                <div key={`${algo.name}-${i}`} className={styles.slotCell}>
                  <AlgoSlotCell slot={slot} />
                </div>
              ))}
            </>
          ))}
        </div>
      </GlassCard>

    </div>
  );
}
