import type { Metadata } from 'next';
import '@/styles/globals.css';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { BgOrbs } from '@/components/layout/BgOrbs';

export const metadata: Metadata = {
  title: 'STAAX — Algo Trading Platform',
  description: 'LIFEX Intelligence Suite · Algorithmic Trading Engine',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* Ambient orbs — fixed behind everything */}
        <BgOrbs />

        {/* Sidebar navigation */}
        <Sidebar />

        {/* Main content area */}
        <div style={{ marginLeft: 'var(--sidebar-w)', position: 'relative', zIndex: 1 }}>
          <TopBar />
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
