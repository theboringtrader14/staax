'use client';
import styles from './TopBar.module.css';
import { Button } from '@/components/ui/Button';
import { PulseDot } from '@/components/ui/Chip';

interface TopBarProps {
  user?: string;
  time?: string;
  pnl?: string;
  pnlPositive?: boolean;
  broker?: string;
  account?: string;
}

export function TopBar({
  user = 'Karthikeyan',
  time,
  pnl = '+₹0',
  pnlPositive = true,
  broker = 'PRACTIX',
  account = 'All Accounts',
}: TopBarProps) {
  return (
    <header className={styles.bar}>
      {/* Left: user + clock + P&L */}
      <div className={styles.left}>
        <div className={styles.avatar}>{user.slice(0, 2).toUpperCase()}</div>
        <span className={styles.welcome}>
          Welcome, <strong>{user}</strong>
        </span>
        {time && <span className={styles.time}>{time}</span>}
        <span className={pnlPositive ? styles.pnlPos : styles.pnlNeg}>{pnl}</span>
      </div>

      {/* Right: account selector + broker badge */}
      <div className={styles.right}>
        <div className={styles.liveIndicator}>
          <PulseDot type="live" />
          <span>Live</span>
        </div>
        <button className={styles.accountPill}>{account} ▾</button>
        <div className={styles.brokerBadge}>
          <PulseDot type="live" />
          {broker}
        </div>
      </div>
    </header>
  );
}
