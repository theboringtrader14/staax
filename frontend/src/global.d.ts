/// <reference types="vite/client" />

// ── Browser Web Speech API ─────────────────────────────────────────────────────
// The standard SpeechRecognition is available in DOM lib but the webkit-prefixed
// variant and the constructor on window need explicit declaration for TypeScript.

interface SpeechRecognitionEventMap {
  audioend: Event
  audiostart: Event
  end: Event
  error: SpeechRecognitionErrorEvent
  nomatch: SpeechRecognitionEvent
  result: SpeechRecognitionEvent
  soundend: Event
  soundstart: Event
  speechend: Event
  speechstart: Event
  start: Event
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult:  ((e: SpeechRecognitionEvent) => void) | null
  onerror:   ((e: SpeechRecognitionErrorEvent) => void) | null
  onend:     (() => void) | null
}

declare var SpeechRecognition: {
  prototype: SpeechRecognition
  new(): SpeechRecognition
}

// ── Global window augmentations ────────────────────────────────────────────────
interface Window {
  webkitSpeechRecognition?: typeof SpeechRecognition
  webkitAudioContext?:      typeof AudioContext
  /** Set by AlgoPage to signal unsaved changes before navigation */
  __staaxDirty?: boolean
}
