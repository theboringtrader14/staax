// STAAX Design Tokens — TypeScript
// Import from here for Tailwind config, inline styles, or CSS-in-JS

export const colors = {
  // Orange Primary Scale
  ox: {
    ultra:   '#FFB366',
    glow:    '#FF8C33',
    radiant: '#FF6B00',  // ★ Primary
    ember:   '#CC4400',  // ★ Dual-tone partner
    deep:    '#8B2500',
  },
  oxAlpha: {
    ghost:    'rgba(255,107,0,0.12)',
    border:   'rgba(255,107,0,0.22)',
    borderHi: 'rgba(255,107,0,0.50)',
    hover:    'rgba(255,107,0,0.08)',
    hoverHi:  'rgba(255,107,0,0.16)',
  },

  // Grey Steel Scale
  gs: {
    muted:   '#8A8A94',
    light:   '#5A5A61',
    mid:     '#3D3D42',
    steel:   '#2A2A2E',
    dark:    '#1A1A1E',
    border:  'rgba(255,255,255,0.07)',
  },

  // Void Backgrounds
  bg: {
    void:    '#0A0A0B',
    deep:    '#111114',
    surface: '#161619',
  },

  // Semantic / Tertiary
  sem: {
    long:   '#22DD88',  // Buy / profit / connected
    short:  '#FF4444',  // Sell / loss / error
    signal: '#4488FF',  // Signal / active algo / info
    warn:   '#FFD700',  // Warning / pending / holiday
  },

  // Semantic alpha
  semAlpha: {
    long:   'rgba(34,221,136,0.12)',
    short:  'rgba(255,68,68,0.12)',
    signal: 'rgba(68,136,255,0.12)',
    warn:   'rgba(255,215,0,0.12)',
  },
} as const;

export const fonts = {
  display: "'Syne', sans-serif",
  mono:    "'JetBrains Mono', monospace",
} as const;

export const radii = {
  sm:   '6px',
  md:   '10px',
  lg:   '14px',
  xl:   '20px',
  pill: '100px',
} as const;

export const glass = {
  bg:           'rgba(22,22,25,0.72)',
  blur:         '20px',
  border:       `0.5px solid ${colors.oxAlpha.border}`,
  steelBg:      'rgba(42,42,46,0.65)',
  steelBorder:  `0.5px solid ${colors.gs.border}`,
} as const;

export const animation = {
  easeSpring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  easeSmooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
  easeOut:    'cubic-bezier(0, 0, 0.2, 1)',
  fast:  '120ms',
  mid:   '220ms',
  slow:  '400ms',
} as const;

// Cloud fill gradient (use as background in inline styles)
export const cloudFill = `
  radial-gradient(ellipse 85% 65% at 15% 25%, rgba(255,107,0,0.16) 0%, transparent 58%),
  radial-gradient(ellipse 55% 75% at 78% 72%, rgba(204,68,0,0.13) 0%, transparent 52%),
  radial-gradient(ellipse 45% 55% at 55% 8%,  rgba(255,140,51,0.09) 0%, transparent 48%),
  radial-gradient(ellipse 65% 38% at 88% 18%, rgba(139,37,0,0.10) 0%, transparent 52%),
  radial-gradient(ellipse 35% 50% at 30% 88%, rgba(255,107,0,0.07) 0%, transparent 45%)
`;

// Tailwind config extension object
export const tailwindExtension = {
  colors: {
    ox: {
      ultra:   colors.ox.ultra,
      glow:    colors.ox.glow,
      radiant: colors.ox.radiant,
      ember:   colors.ox.ember,
      deep:    colors.ox.deep,
    },
    gs: colors.gs,
    bg: colors.bg,
    long:   colors.sem.long,
    short:  colors.sem.short,
    signal: colors.sem.signal,
    warn:   colors.sem.warn,
  },
  fontFamily: {
    display: [fonts.display],
    mono:    [fonts.mono],
  },
  borderRadius: radii,
  backdropBlur: { glass: glass.blur },
};
