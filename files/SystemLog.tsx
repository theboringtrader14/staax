'use client';
import { useEffect, useRef } from 'react';
import styles from './SystemLog.module.css';
import { PulseDot } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';

export interface LogEntry {
  time: string;
  type: 'ok' | 'error' | 'neutral';
  message: string;
}

interface SystemLogProps {
  entries: LogEntry[];
  autoScroll?: boolean;
}

export function SystemLog({ entries, autoScroll = true }: SystemLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries, autoScroll]);

  // Group entries by date label
  const grouped = entries.reduce<{ date: string; items: LogEntry[] }[]>((acc, entry) => {
    // Simple: use first 8 chars of message as date proxy — in real app parse date
    const last = acc[acc.length - 1];
    if (!last) acc.push({ date: '', items: [entry] });
    else last.items.push(entry);
    return acc;
  }, []);

  return (
    <GlassCard cloud noPad>
      <div className={styles.header}>
        <PulseDot type="live" />
        <span className={styles.title}>System Log</span>
      </div>
      <div className={styles.log}>
        {entries.map((entry, i) => (
          <div key={i} className={`${styles.entry} ${styles[entry.type]}`}>
            <span className={styles.time}>[{entry.time}]</span>
            {' '}{entry.message}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </GlassCard>
  );
}
