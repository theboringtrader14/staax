'use client';
import { ReactNode, CSSProperties } from 'react';
import styles from './GlassCard.module.css';
import { cn } from '@/lib/utils';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  cloud?: boolean;    // apply the abstract cloud fill
  steel?: boolean;    // use the darker steel variant
  noPad?: boolean;    // opt out of default padding
  onClick?: () => void;
}

export function GlassCard({
  children,
  className,
  style,
  cloud = false,
  steel = false,
  noPad = false,
  onClick,
}: GlassCardProps) {
  return (
    <div
      className={cn(
        styles.card,
        steel ? styles.steel : styles.orange,
        cloud && styles.cloud,
        !noPad && styles.padded,
        onClick && styles.clickable,
        className,
      )}
      style={style}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
