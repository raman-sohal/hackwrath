import { useEffect } from 'react'
import { AudioCapture } from '@renderer/audio/capture'
import { DemoEngine, WebSpeechEngine } from '@renderer/asr/engines'
import { useAppStore } from '@renderer/state/store'

const CHUNK_MS = 4000

/**
 * Owns the caption engine lifecycle. Effects keyed on listening/paused/engine
 * so stopping is always symmetrical: tracks are released and the ASR queue is
 * abandoned.
 */
export function useCaptionEngine(): void {
  const listening = useAppStore((s) => s.listening)
  const paused = useAppStore((s) => s.paused)
  const engine = useAppStore((s) => s.settings.engine)
  const activeId = useAppStore((s) => s.active?.id ?? null)

  useEffect(() => {
    if (!listening || paused || !activeId) return
    let cancelled = false
    let capture: AudioCapture | null = null
    let demo: DemoEngine | null = null
    let webSpeech: WebSpeechEngine | null = null
    let busy = false

    const store = useAppStore.getState()
    const startedAt = store.active?.startedAt ?? Date.now()
    const commit = (
      text: string,
      startMs: number,
      endMs: number,
      confidence?: number,
      speaker?: 'Teacher' | 'Student'
    ): void => {
      if (cancelled || !text.trim()) return
      void useAppStore.getState().commitSegment(text, startMs, endMs, confidence, speaker)
    }

    if (engine === 'demo') {
      demo = new DemoEngine()
      demo.start(
        (text) => !cancelled && useAppStore.getState().setInterim(text),
        (text, speaker) => {
          if (cancelled) return
          const now = Date.now() - startedAt
          commit(text, Math.max(0, now - 3400), now, 0.94, speaker)
          useAppStore.getState().setLatency(420)
        }
      )
    } else if (engine === 'webspeech') {
      webSpeech = new WebSpeechEngine()
      const ok = webSpeech.start(
        (text) => !cancelled && useAppStore.getState().setInterim(text),
        (text) => {
          if (cancelled) return
          const now = Date.now() - startedAt
          commit(text, Math.max(0, now - 2600), now, 0.82)
        },
        (message) => {
          if (cancelled) return
          useAppStore.getState().setEngineError(message)
          useAppStore.getState().setListening(false)
        }
      )
      if (!ok) useAppStore.getState().setListening(false)
    } else {
      void (async () => {
        try {
          const granted = await window.api.media.grant('microphone', true)
          if (!granted) throw new Error('Microphone consent is off. Enable the microphone or use Demo mode.')
          const status = await window.api.asr.status()
          if (!status.modelPresent || !status.serverPresent) {
            throw new Error(
              'On-device Whisper is not available. Install whisper.cpp and run npm run fetch-model, or use Demo mode.'
            )
          }
          capture = new AudioCapture()
          await capture.start(async (pcm, sampleRate) => {
            if (cancelled || busy) return
            busy = true
            const endMs = Date.now() - startedAt
            try {
              const result = await window.api.asr.transcribe(pcm.buffer.slice(0) as ArrayBuffer, sampleRate)
              if (cancelled) return
              useAppStore.getState().setLatency(result.ms)
              if (result.text) {
                commit(result.text, Math.max(0, endMs - CHUNK_MS), endMs, result.confidence)
                useAppStore.getState().setInterim('')
              }
            } catch (err) {
              if (!cancelled) {
                useAppStore.getState().setEngineError(err instanceof Error ? err.message : 'Transcription failed')
              }
            } finally {
              busy = false
            }
          }, (level) => {
            if (!cancelled) useAppStore.getState().setLevel(level)
          })
        } catch (err) {
          if (cancelled) return
          const message =
            err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
              ? 'Microphone permission was denied. Enable it in System Settings, or use Demo mode.'
              : err instanceof Error
                ? err.message
                : 'Could not start the microphone.'
          useAppStore.getState().setEngineError(message)
          useAppStore.getState().setListening(false)
        }
      })()
    }

    return () => {
      cancelled = true
      demo?.stop()
      webSpeech?.stop()
      capture?.stop()
      void window.api.media.grant('microphone', false)
      useAppStore.getState().setLevel(0)
      useAppStore.getState().setInterim('')
    }
  }, [listening, paused, engine, activeId])
}
