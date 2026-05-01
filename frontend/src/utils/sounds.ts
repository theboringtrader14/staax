// Click sounds using Web Audio API — no external files needed
// window.webkitAudioContext is declared in src/global.d.ts
const AudioCtx = typeof window !== 'undefined' ? (window.AudioContext ?? window.webkitAudioContext) : undefined
const ctx = AudioCtx ? new AudioCtx() : null

function playTone(freq: number, duration: number, type: OscillatorType = 'sine', gain = 0.1) {
  if (!ctx) return
  const osc = ctx.createOscillator()
  const gainNode = ctx.createGain()
  osc.connect(gainNode)
  gainNode.connect(ctx.destination)
  osc.type = type
  osc.frequency.setValueAtTime(freq, ctx.currentTime)
  gainNode.gain.setValueAtTime(gain, ctx.currentTime)
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
  osc.start(ctx.currentTime)
  osc.stop(ctx.currentTime + duration)
}

export const sounds = {
  click: () => playTone(800, 0.05, 'sine', 0.08),
  toggleOn: () => { playTone(600, 0.06, 'sine', 0.1); setTimeout(() => playTone(900, 0.06, 'sine', 0.1), 60) },
  toggleOff: () => { playTone(900, 0.06, 'sine', 0.1); setTimeout(() => playTone(600, 0.06, 'sine', 0.1), 60) },
  orderPlaced: () => { [440, 550, 660].forEach((f, i) => setTimeout(() => playTone(f, 0.15, 'sine', 0.12), i * 80)) },
  orderRejected: () => playTone(200, 0.2, 'sawtooth', 0.06),
  slHit: () => { playTone(440, 0.1, 'square', 0.08); setTimeout(() => playTone(330, 0.2, 'square', 0.08), 120) },
  strategyStart: () => { [440, 660, 880].forEach((f, i) => setTimeout(() => playTone(f, 0.1, 'sine', 0.1), i * 60)) },
  strategyStop: () => { [880, 660, 440].forEach((f, i) => setTimeout(() => playTone(f, 0.1, 'sine', 0.1), i * 60)) },
  notification: () => { playTone(880, 0.08, 'sine', 0.07); setTimeout(() => playTone(1100, 0.12, 'sine', 0.07), 90) },
  error: () => playTone(220, 0.3, 'sawtooth', 0.06),
}

export function initSounds() {
  if (ctx && ctx.state === 'suspended') ctx.resume()
}
