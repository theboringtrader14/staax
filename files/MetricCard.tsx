'use client';
import { ReactNode } from 'react';
import { GlassCard } from './GlassCard';
import { cn } from '@/lib/utils';
import styles from './MetricCard.module.css';

interface MetricCardProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: { value: string; positive?: boolean };
  sparkline?: number[];  // array of y values (0–100 scale)
  className?: string;
  steel?: boolean;
}

export function MetricCard({ label, value, sub, delta, sparkline, className, steel }: MetricCardProps) {
  return (
    <GlassCard cloud className={cn(styles.card, className)} steel={steel}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{value}</div>
      {sub && <div className={styles.sub}>{sub}</div>}
      {delta && (
        <div className={cn(styles.delta, delta.positive ? styles.pos : styles.neg)}>
          {delta.positive ? '▲' : '▼'} {delta.value}
        </div>
      )}
      {sparkline && sparkline.length > 1 && (
        <SparkLine data={sparkline} />
      )}
    </GlassCard>
  );
}

function SparkLine({ data }: { data: number[] }) {
  const h = 36;
  const w = 120;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const step = w / (data.length - 1);

  const points = data
    .map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 4)}`)
    .join(' ');

  const fill = data.map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 4)}`).join(' ');
  const fillPath = `${fill} ${w},${h} 0,${h}`;

  return (
    <svg className={styles.spark} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={fillPath} fill="rgba(204,68,0,0.08)" stroke="none" />
      <polyline
        points={points}
        fill="none"
        stroke="var(--ox-ember)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
