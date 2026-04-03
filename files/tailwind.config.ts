import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Orange Primary
        'ox-ultra':   '#FFB366',
        'ox-glow':    '#FF8C33',
        'ox-radiant': '#FF6B00',
        'ox-ember':   '#CC4400',
        'ox-deep':    '#8B2500',

        // Grey Steel
        'gs-muted':  '#8A8A94',
        'gs-light':  '#5A5A61',
        'gs-mid':    '#3D3D42',
        'gs-steel':  '#2A2A2E',
        'gs-dark':   '#1A1A1E',

        // Void Backgrounds
        'bg-void':    '#0A0A0B',
        'bg-deep':    '#111114',
        'bg-surface': '#161619',

        // Semantic
        'sem-long':   '#22DD88',
        'sem-short':  '#FF4444',
        'sem-signal': '#4488FF',
        'sem-warn':   '#FFD700',
      },
      fontFamily: {
        display: ['Syne', 'sans-serif'],
        mono:    ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        sm:   '6px',
        md:   '10px',
        lg:   '14px',
        xl:   '20px',
        pill: '100px',
      },
      backdropBlur: {
        glass: '20px',
      },
      animation: {
        'fade-up':    'fadeUp 400ms cubic-bezier(0,0,0.2,1) both',
        'scale-in':   'scaleIn 400ms cubic-bezier(0.34,1.56,0.64,1) both',
        'pulse-live': 'pulseLive 2s ease-out infinite',
      },
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.94)' },
          to:   { opacity: '1', transform: 'scale(1)' },
        },
        pulseLive: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.4' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
