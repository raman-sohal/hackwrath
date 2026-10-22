const DEMO_LINES: Array<{ speaker: 'Teacher' | 'Student'; text: string }> = [
  { speaker: 'Teacher', text: 'Good morning everyone. Today we are looking at the Hamiltonian and why it matters.' },
  { speaker: 'Teacher', text: 'The Hamiltonian is the operator that represents the total energy of a quantum system.' },
  { speaker: 'Teacher', text: 'For a simple harmonic oscillator, it is the sum of kinetic and potential energy.' },
  { speaker: 'Student', text: 'Could you repeat the part about the eigenvalues?' },
  { speaker: 'Teacher', text: 'Of course. The eigenvalues of the Hamiltonian are the allowed energy levels.' },
  { speaker: 'Teacher', text: 'When the spectrum is non-degenerate, each eigenvalue has exactly one eigenstate.' },
  { speaker: 'Teacher', text: 'Degeneracy appears when two or more states share the same energy.' },
  { speaker: 'Student', text: 'So degeneracy is connected to symmetry?' },
  { speaker: 'Teacher', text: 'Exactly. Symmetry usually implies degeneracy, and that connection is very useful.' },
  { speaker: 'Teacher', text: 'Let us write the time independent Schrodinger equation on the board.' },
  { speaker: 'Teacher', text: 'Remember that the wavefunction must be normalisable for a bound state.' },
  { speaker: 'Teacher', text: 'We will revisit this with the hydrogen atom next week.' },
  { speaker: 'Teacher', text: 'Before you leave, please read the first two sections of the notes.' },
  { speaker: 'Teacher', text: 'And bring one question about the spectrum to the next class.' }
]

/** Deterministic demo stream: keeps the UI demoable without a microphone. */
export class DemoEngine {
  private index = 0
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private partialTimer: ReturnType<typeof setTimeout> | null = null

  start(
    onPartial: (text: string) => void,
    onFinal: (text: string, speaker: 'Teacher' | 'Student') => void
  ): void {
    this.stopped = false
    const tick = (): void => {
      if (this.stopped) return
      const line = DEMO_LINES[this.index % DEMO_LINES.length]
      this.index += 1
      const cut = Math.max(12, Math.floor(line.text.length * 0.55))
      onPartial(line.text.slice(0, cut))
      this.partialTimer = setTimeout(() => {
        if (this.stopped) return
        onFinal(line.text, line.speaker)
        this.timer = setTimeout(tick, 1600)
      }, 650)
    }
    tick()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    if (this.partialTimer) clearTimeout(this.partialTimer)
    this.timer = null
    this.partialTimer = null
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Optional browser speech engine. Clearly labelled as cloud-backed in the UI
 * because Chromium's implementation usually sends audio to a vendor.
 * It is never enabled by default.
 */
export class WebSpeechEngine {
  private recognition: any = null
  private stopped = false

  start(
    onPartial: (text: string) => void,
    onFinal: (text: string) => void,
    onError: (message: string) => void
  ): boolean {
    const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
    if (!Ctor) {
      onError('Browser speech recognition is not available in this build.')
      return false
    }
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-IN'
    rec.onresult = (event: any) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) onFinal(String(result[0].transcript).trim())
        else interim += result[0].transcript
      }
      if (interim) onPartial(interim)
    }
    rec.onerror = (event: any) => {
      if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
        onError('Microphone or speech service was denied.')
      }
    }
    rec.onend = () => {
      if (!this.stopped) {
        try {
          rec.start()
        } catch {
          /* ignore restart races */
        }
      }
    }
    this.recognition = rec
    try {
      rec.start()
      return true
    } catch {
      onError('Could not start browser speech recognition.')
      return false
    }
  }

  stop(): void {
    this.stopped = true
    try {
      this.recognition?.stop()
    } catch {
      /* ignore */
    }
    this.recognition = null
  }
}
