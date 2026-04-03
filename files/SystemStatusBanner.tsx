'use client';
import styles from './SystemStatusBanner.module.css';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

export interface StatusCheck {
  label: string;
  ok: boolean;
}

interface SystemStatusBannerProps {
  ready: boolean;
  time: string;
  checks: StatusCheck[];
  onRefresh?: () => void;
}

export function SystemStatusBanner({ ready, time, checks, onRefresh }: SystemStatusBannerProps) {
  return (
    <GlassCard cloud noPad className={styles.banner}>
      <div className={styles.top}>
        <div className={styles.statusRow}>
          <span className={cn(styles.dot, ready ? styles.dotOk : styles.dotWarn)} />
          <span className={cn(styles.statusText, ready ? styles.ok : styles.warn)}>
            {ready ? 'System Ready' : 'System Not Ready'}
          </span>
          <span className={styles.time}>{time}</span>
        </div>
        <Button variant="steel" size="sm" onClick={onRefresh}>Refresh</Button>
      </div>

      <div className={styles.checks}>
        {checks.map((c, i) => (
          <div key={i} className={styles.check}>
            <span className={c.ok ? styles.checkOk : styles.checkErr}>
              {c.ok ? '✓' : '✗'}
            </span>
            <span className={cn(styles.checkLabel, !c.ok && styles.checkLabelErr)}>
              {c.label}
            </span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
