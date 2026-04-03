'use client';
import { ReactNode, ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'ghost' | 'steel' | 'danger';
type Size    = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
  loading?: boolean;
}

export function Button({
  variant = 'steel',
  size = 'md',
  children,
  loading,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        styles.btn,
        styles[variant],
        styles[size],
        (loading || disabled) && styles.disabled,
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <span className={styles.spinner} />}
      {children}
    </button>
  );
}
