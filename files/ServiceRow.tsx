'use client';
import styles from './ServiceRow.module.css';
import { Button } from '@/components/ui/Button';
import { PulseDot, Chip } from '@/components/ui/Chip';
import { cn } from '@/lib/utils';

type ServiceStatus = 'running' | 'stopped' | 'error';

interface ServiceRowProps {
  name: string;
  host: string;
  status: ServiceStatus;
  onStart?: () => void;
  onStop?: () => void;
  isLogin?: boolean;
  loginLabel?: string;
}

export function ServiceRow({
  name,
  host,
  status,
  onStart,
  onStop,
  isLogin,
  loginLabel,
}: ServiceRowProps) {
  const dotType = status === 'running' ? 'live' : status === 'error' ? 'error' : 'warn';

  return (
    <div className={cn(styles.row, styles[status])}>
      <PulseDot type={dotType} />

      <div className={styles.info}>
        <div className={styles.name}>{name}</div>
        <div className={styles.host}>{host}</div>
      </div>

      <Chip
        variant={status === 'running' ? 'success' : status === 'error' ? 'error' : 'steel'}
        className={styles.statusChip}
      >
        {status === 'running' ? 'Running' : status === 'error' ? 'Error' : 'Stopped'}
      </Chip>

      {isLogin ? (
        <Button variant="ghost" size="sm">🔑 {loginLabel || 'Login'}</Button>
      ) : status === 'running' ? (
        <Button variant="danger" size="sm" onClick={onStop}>Stop</Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={onStart}>Start</Button>
      )}
    </div>
  );
}
