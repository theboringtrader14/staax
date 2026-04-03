'use client';
import { ReactNode } from 'react';
import styles from './Chip.module.css';
import { cn } from '@/lib/utils';

type ChipVariant = 'active' | 'orange' | 'steel' | 'success' | 'error' | 'warn' | 'signal';
type StatusVariant = 'active' | 'closed' | 'waiting' | 'pending' | 'error' | 'notrade';

interface ChipProps {
  variant?: ChipVariant;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

export function Chip({ variant = 'steel', dot, children, className }: ChipProps) {
  return (
    <span className={cn(styles.chip, styles[`chip_${variant}`], className)}>
      {dot && <span className={styles.dot} />}
      {children}
    </span>
  );
}

interface StatusLabelProps {
  status: StatusVariant;
  children: ReactNode;
  className?: string;
}

export function StatusLabel({ status, children, className }: StatusLabelProps) {
  return (
    <span className={cn(styles.statusLabel, styles[`status_${status}`], className)}>
      {children}
    </span>
  );
}

// Pulse dot indicators
export function PulseDot({ type }: { type: 'live' | 'warn' | 'error' }) {
  return <span className={cn(styles.pulseDot, styles[`pulse_${type}`])} />;
}
