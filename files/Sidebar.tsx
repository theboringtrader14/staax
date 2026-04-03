'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './Sidebar.module.css';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/dashboard', icon: '⌂', label: 'Dashboard' },
  { href: '/grid',      icon: '⊞', label: 'Smart Grid' },
  { href: '/algos',     icon: '+', label: 'Algos' },
  { href: '/trades',    icon: '≡', label: 'Trades' },
  { href: '/analytics', icon: '⟁', label: 'Analytics' },
  { href: '/positions', icon: '▣', label: 'Positions' },
  { href: '/profile',   icon: '◯', label: 'Profile' },
];

export function Sidebar() {
  const path = usePathname();

  return (
    <aside className={styles.sidebar}>
      {/* Logo mark */}
      <div className={styles.logoMark}>
        <span>S</span>
      </div>

      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(styles.navItem, path === item.href && styles.active)}
            title={item.label}
          >
            <span className={styles.icon}>{item.icon}</span>
            <span className={styles.tooltip}>{item.label}</span>
          </Link>
        ))}
      </nav>

      {/* Bottom logout */}
      <button className={cn(styles.navItem, styles.logout)} title="Sign out">
        <span className={styles.icon}>→</span>
        <span className={styles.tooltip}>Sign out</span>
      </button>
    </aside>
  );
}
