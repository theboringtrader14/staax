/**
 * HoneycombBackground — fixed full-screen SVG honeycomb overlay.
 * Static dual-horizon-inverse hexagon grid rendered behind all page content.
 */
export default function HoneycombBackground() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      <img
        src="/honeycomb-bg.svg"
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: 0.55,
        }}
      />
    </div>
  )
}
