import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@renderer/state/store'
import type { SignPrediction, SignStatus } from '@shared/types'
import { SignWordBuilder, type SignBuilderOptions, type SignEvent, type SignLetter } from '@shared/sign'
import { isKnownWord, repairWord, suggestWords } from '@shared/words'
import { FrameAnalyzer, toRgb, type CropRect } from '@renderer/lib/frame'
import { speak } from '@renderer/lib/utils'
import {
  CameraIcon,
  CheckIcon,
  FilmIcon,
  HandIcon,
  LockIcon,
  SendIcon,
  SparkIcon,
  TrashIcon,
  WaveIcon,
  XIcon
} from './Icons'
import { VideoImport } from './VideoImport'

const INPUT = 224
/** Cheap downsampled copy used only to find the hand and measure motion. */
const PROBE_WIDTH = 96
const SAMPLE_MS = 300
/** Frames changing more than this are mid-motion, so no letter is accepted. */
const MAX_MOTION = 18

/**
 * Live tuning. The letter bar is deliberately similar to the video pipeline so
 * a letter signed on camera behaves the same way when it is recorded and
 * imported later.
 */
const CAMERA_OPTIONS: Partial<SignBuilderOptions> = {
  minScore: 0.1,
  minMargin: 0.02,
  unverifiedMinScore: 0.2,
  voteWindow: 8,
  voteNeeded: 2,
  maxMotion: MAX_MOTION,
  wordGapMs: 1400,
  maxWordLength: 32
}

interface TrackedWord {
  text: string
  /** What the model actually spelled, before the dictionary repair. */
  raw: string
  confidence: number
  known: boolean
}

interface SignalState {
  hand: boolean
  motion: number
  zoom: number
  coverage: number
  crop: CropRect
}

export function SignView(): React.JSX.Element {
  const consent = useAppStore((s) => s.consent)
  const active = useAppStore((s) => s.active)
  const shield = useAppStore((s) => s.shield)
  const glossary = useAppStore((s) => s.settings.glossary)
  const enableCamera = useAppStore((s) => s.enableCamera)
  const setCameraActive = useAppStore((s) => s.setCameraActive)
  const insertSignedText = useAppStore((s) => s.insertSignedText)
  const setView = useAppStore((s) => s.setView)
  const showToast = useAppStore((s) => s.showToast)

  const [mode, setMode] = useState<'camera' | 'video'>('camera')
  const [status, setStatus] = useState<SignStatus | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prediction, setPrediction] = useState<SignPrediction | null>(null)
  const [alternatives, setAlternatives] = useState<SignPrediction[]>([])
  const [lastMs, setLastMs] = useState<number | null>(null)
  const [held, setHeld] = useState<string | null>(null)
  const [letters, setLetters] = useState<SignLetter[]>([])
  const [words, setWords] = useState<TrackedWord[]>([])
  const [draft, setDraft] = useState('')
  const [signal, setSignal] = useState<SignalState | null>(null)
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null)
  const [savedLabel, setSavedLabel] = useState<string | null>(null)
  const [inserting, setInserting] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const busyRef = useRef(false)
  const startedAtRef = useRef(0)
  const builderRef = useRef(new SignWordBuilder(CAMERA_OPTIONS))
  const analyzerRef = useRef(new FrameAnalyzer())
  const draftRef = useRef('')
  const wordsRef = useRef<TrackedWord[]>([])

  const suggestions = useMemo(
    () => suggestWords(draft, glossary, 4).filter((item) => item.word !== draft.trim().toLowerCase()),
    [draft, glossary]
  )

  const sentence = useMemo(() => {
    const text = [...words.map((item) => item.text), draft].join(' ').replace(/\s+/g, ' ').trim()
    return text
  }, [draft, words])

  /** Mirrors the mutable tracking refs into render state. */
  const syncReader = useCallback((): void => {
    setDraft(draftRef.current)
    setWords([...wordsRef.current])
    setLetters([...builderRef.current.letters].slice(-24))
    setHeld(builderRef.current.letters.at(-1)?.label ?? null)
  }, [])

  /** Turns builder events into the editable word list. */
  const absorb = useCallback(
    (events: SignEvent[]): void => {
      if (events.length === 0) return
      for (const event of events) {
        if (event.type === 'letter') {
          draftRef.current = (draftRef.current + event.label).slice(0, 64)
          continue
        }
        const raw = draftRef.current.trim()
        draftRef.current = ''
        if (!raw) continue

        const last = wordsRef.current.at(-1)
        const repaired = repairWord(raw, glossary) ?? raw

        // If the new word combined with the last one forms a dictionary word,
        // and they were signed close together, merge them. This fixes the case
        // where a slow transition splits "HELLO" into "H" + "ELLO".
        if (last && event.word.gapMs < 2000) {
          const combined = (last.text + repaired).toLowerCase()
          if (isKnownWord(combined, glossary)) {
            wordsRef.current = [
              ...wordsRef.current.slice(0, -1),
              {
                text: combined.toUpperCase(),
                raw: last.raw + raw,
                confidence: (last.confidence + event.word.confidence) / 2,
                known: true
              }
            ]
            continue
          }
        }

        wordsRef.current = [
          ...wordsRef.current,
          {
            text: repaired,
            raw,
            confidence: event.word.confidence,
            known: isKnownWord(repaired, glossary)
          }
        ]
      }
      syncReader()
    },
    [glossary, syncReader]
  )

  /** Ends the word in progress, e.g. when the hand leaves or the camera stops. */
  const endWord = useCallback((): void => {
    const event = builderRef.current.finish(Date.now() - startedAtRef.current)
    if (event) absorb([event])
  }, [absorb])

  const stopCamera = useCallback(() => {
    endWord()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    analyzerRef.current.reset()
    setStreaming(false)
    setCameraActive(false)
    setSignal(null)
    setPrediction(null)
    setAlternatives([])
    setLastMs(null)
    setFrameSize(null)
    void window.api.media.grant('camera', false).catch(() => {
      /* window may be closing */
    })
  }, [endWord, setCameraActive])

  useEffect(() => {
    let alive = true
    window.api.sign
      .status()
      .then((next) => {
        if (alive) setStatus(next)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Could not check the sign model.')
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.hidden && streamRef.current) stopCamera()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [stopCamera])

  // The privacy shield must also stop the camera, not just cover the pixels.
  useEffect(() => {
    if (shield && streamRef.current) stopCamera()
  }, [shield, stopCamera])

  const startCamera = useCallback(async () => {
    if (starting || streaming) return
    if (!status?.modelPresent) {
      setError('The sign model is not installed yet.')
      return
    }
    setStarting(true)
    setError(null)
    setSavedLabel(null)
    try {
      const granted = await window.api.media.grant('camera', true)
      if (!granted) throw new Error('Camera access is not enabled. Enable camera consent first.')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 960 },
          height: { ideal: 720 },
          facingMode: 'user',
          frameRate: { ideal: 15, max: 30 }
        }
      })
      const video = videoRef.current
      const cancelled = !video || useAppStore.getState().shield || document.hidden
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop())
        void window.api.media.grant('camera', false).catch(() => {
          /* ignore */
        })
        if (!video) throw new Error('Camera preview is not ready.')
        return
      }
      streamRef.current = stream
      video.srcObject = stream
      stream.getTracks().forEach((track) => track.addEventListener('ended', () => stopCamera()))
      await video.play()
      builderRef.current.reset()
      analyzerRef.current.reset()
      draftRef.current = ''
      wordsRef.current = []
      syncReader()
      startedAtRef.current = Date.now()
      setStreaming(true)
      setCameraActive(true)
    } catch (err) {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      if (videoRef.current) videoRef.current.srcObject = null
      void window.api.media.grant('camera', false).catch(() => {
        /* ignore */
      })
      setStreaming(false)
      setCameraActive(false)
      const name = err instanceof DOMException ? err.name : ''
      setError(
        name === 'NotAllowedError' || name === 'PermissionDeniedError'
          ? 'Camera permission was denied. Allow camera access in System Settings, then try again.'
          : err instanceof Error
            ? err.message
            : 'Could not start the camera.'
      )
    } finally {
      setStarting(false)
    }
  }, [setCameraActive, starting, status?.modelPresent, streaming, stopCamera, syncReader])

  useEffect(() => {
    if (!streaming || !status?.modelPresent) return
    let cancelled = false
    const builder = builderRef.current
    const analyzer = analyzerRef.current

    const canvas = document.createElement('canvas')
    canvas.width = INPUT
    canvas.height = INPUT
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const probe = document.createElement('canvas')
    const probeContext = probe.getContext('2d', { willReadFrequently: true })
    if (!context || !probeContext) return
    const rgb = new Uint8Array(INPUT * INPUT * 3)

    const tick = async (): Promise<void> => {
      if (cancelled || busyRef.current) return
      const video = videoRef.current
      if (!video || video.readyState < 2 || video.videoWidth === 0) return

      // 1. Where is the hand? A small copy of the whole frame answers that
      //    without touching the pixels that get classified.
      const probeWidth = Math.min(PROBE_WIDTH, video.videoWidth)
      const probeHeight = Math.max(1, Math.round((probeWidth * video.videoHeight) / video.videoWidth))
      if (probe.width !== probeWidth || probe.height !== probeHeight) {
        probe.width = probeWidth
        probe.height = probeHeight
      }
      probeContext.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, probeWidth, probeHeight)
      const probeData = probeContext.getImageData(0, 0, probeWidth, probeHeight)
      const analysis = analyzer.analyze(probeData.data, probeWidth, probeHeight)
      const crop = analyzer.crop(video.videoWidth, video.videoHeight)

      // 2. Crop to the tracked region and classify it.
      context.drawImage(video, crop.sx, crop.sy, crop.side, crop.side, 0, 0, INPUT, INPUT)
      const { data } = context.getImageData(0, 0, INPUT, INPUT)
      toRgb(data, rgb)

      busyRef.current = true
      try {
        const result = await window.api.sign.classify(rgb, INPUT, INPUT)
        if (cancelled) return
        if (result.error) setError(result.error)
        const top = result.predictions[0] ?? null
        if (top) {
          setPrediction(top)
          setAlternatives(result.predictions.slice(1, 4))
          setLastMs(result.ms)
        }
        setFrameSize((current) =>
          current && current.width === video.videoWidth && current.height === video.videoHeight
            ? current
            : { width: video.videoWidth, height: video.videoHeight }
        )
        setSignal({
          hand: analysis.hand,
          motion: analysis.motion,
          zoom: analysis.zoom,
          coverage: analysis.coverage,
          crop
        })
        absorb(
          builder.push({
            label: top?.label ?? null,
            score: top?.score ?? 0,
            second: result.predictions[1]?.score,
            atMs: Date.now() - startedAtRef.current,
            hand: analysis.hand,
            motion: analysis.motion
          })
        )
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Sign inference failed.')
      } finally {
        busyRef.current = false
      }
    }

    const timer = setInterval(() => void tick(), SAMPLE_MS)
    void tick()
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [absorb, status?.modelPresent, streaming])

  const insert = async (): Promise<void> => {
    const text = sentence.trim()
    if (!text || inserting) return
    setInserting(true)
    try {
      const best = wordsRef.current.reduce((score, item) => Math.max(score, item.confidence), 0)
      const ok = await insertSignedText(text, best > 0 ? best : (prediction?.score ?? 0.8))
      if (!ok) return
      setSavedLabel(text)
      builderRef.current.reset()
      draftRef.current = ''
      wordsRef.current = []
      syncReader()
      showToast('Signed text added to the transcript.', 'ok')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the signed text.')
    } finally {
      setInserting(false)
    }
  }

  const breakWord = (): void => {
    endWord()
    const raw = draftRef.current.trim()
    draftRef.current = ''
    if (raw) {
      const repaired = repairWord(raw, glossary) ?? raw
      wordsRef.current = [
        ...wordsRef.current,
        { text: repaired, raw, confidence: 0.8, known: isKnownWord(repaired, glossary) }
      ]
    }
    syncReader()
  }

  const dropLetter = (): void => {
    draftRef.current = draftRef.current.slice(0, -1)
    syncReader()
  }

  const clearAll = (): void => {
    builderRef.current.reset()
    draftRef.current = ''
    wordsRef.current = []
    syncReader()
    setSavedLabel(null)
  }

  const applySuggestion = (word: string): void => {
    const raw = draftRef.current.trim()
    if (!raw) return
    const repaired = word
    wordsRef.current = [
      ...wordsRef.current,
      { text: repaired, raw, confidence: 0.9, known: isKnownWord(repaired, glossary) }
    ]
    builderRef.current.finish(Date.now() - startedAtRef.current)
    draftRef.current = ''
    syncReader()
  }

  const confidence = prediction ? Math.round(prediction.score * 100) : 0
  const modelMissing = status && !status.modelPresent

  const changeMode = (next: 'camera' | 'video'): void => {
    if (next === mode) return
    if (next === 'video') stopCamera()
    setError(null)
    setMode(next)
  }

  // The crop rectangle is mapped back onto the preview. The preview element is
  // pinned to the camera's aspect ratio, so this is pixel-exact.
  const guide =
    streaming && signal && frameSize && frameSize.width > 0 && frameSize.height > 0
      ? {
        width: `${(signal.crop.side / frameSize.width) * 100}%`,
        height: `${(signal.crop.side / frameSize.height) * 100}%`,
        left: `${(1 - (signal.crop.sx + signal.crop.side / 2) / frameSize.width) * 100 - (signal.crop.side / frameSize.width) * 50}%`,
        top: `${((signal.crop.sy + signal.crop.side / 2) / frameSize.height) * 100 - (signal.crop.side / frameSize.height) * 50}%`
      }
      : null

  const tracking = !streaming
    ? 'Camera is off'
    : !signal
      ? 'Reading the first frame…'
      : !signal.hand
        ? 'No hand in view — move your hand into frame'
        : signal.motion > MAX_MOTION
          ? 'Hold still — the hand is moving'
          : held
            ? `Holding ${held}`
            : 'Ready — show a letter'

  return (
    <div className="page sign-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">
            {mode === 'camera' ? 'Camera · processed on this device' : 'Local video · processed on this device'}
          </p>
          <h1>Fingerspell to text.</h1>
          <p className="page-sub">
            {mode === 'camera'
              ? 'Hold an ASL letter in front of the camera. EchoClass tracks your hand, votes across frames, and assembles the letters into words. Frames are never recorded, saved, or uploaded.'
              : 'Import a recorded fingerspelling video. EchoClass scans the whole clip for movement, samples the busy moments closely, and turns recognised letters into timestamped caption words. The file is never copied, recorded, or uploaded.'}
          </p>
        </div>
        <div className="page-actions">
          <span className={`status-pill ${mode === 'camera' && streaming ? 'is-live' : ''}`} title="Input state">
            {mode === 'camera' ? <CameraIcon size={14} /> : <FilmIcon size={14} />}
            {mode === 'camera' ? (streaming ? 'Camera on' : 'Camera off') : 'Video file'}
          </span>
          <span className="status-pill is-good" title="Frames are discarded after inference">
            <LockIcon size={14} />
            No recording
          </span>
        </div>
      </header>

      {status && !modelMissing && (
        <div className="sign-mode-switch" role="tablist" aria-label="Fingerspelling input mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'camera'}
            className={mode === 'camera' ? 'is-active' : ''}
            onClick={() => changeMode('camera')}
          >
            <CameraIcon size={15} /> Live camera
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'video'}
            className={mode === 'video' ? 'is-active' : ''}
            onClick={() => changeMode('video')}
          >
            <FilmIcon size={15} /> Video file
          </button>
          <span className="sign-mode-note">
            {mode === 'camera' ? 'Optional camera · off by default' : 'Local file · no camera permission needed'}
          </span>
        </div>
      )}

      {!status ? (
        <div className="sign-gate">
          <div className="empty-icon"><SparkIcon size={26} /></div>
          <h2>Checking the local sign model…</h2>
          <p>This reads a bundled ONNX file. No network request is made.</p>
        </div>
      ) : modelMissing ? (
        <div className="sign-gate">
          <div className="empty-icon"><HandIcon size={26} /></div>
          <h2>Sign model not installed</h2>
          <p>
            The ASL alphabet model from <strong>prithivMLmods/Alphabet-Sign-Language-Detection</strong> has not been
            converted for this build. Run the one-time converter, then restart EchoClass.
          </p>
          <code className="sign-command">build/sign-venv/bin/python scripts/convert-sign-model.py</code>
          <p className="sign-fine">The desktop app never downloads models at runtime. See models/sign/README.md.</p>
        </div>
      ) : mode === 'video' ? (
        <VideoImport />
      ) : !consent?.camera ? (
        <div className="sign-gate">
          <div className="empty-icon"><CameraIcon size={26} /></div>
          <h2>Camera access is off</h2>
          <p>
            Camera is optional and off by default. Turning it on allows this page to read frames while it is open.
            Audio stays off, and no frame is ever written to disk.
          </p>
          <button
            type="button"
            className="button button-primary button-lg"
            onClick={() =>
              void enableCamera()
                .then(() => showToast('Camera access enabled. Turn the camera on when ready.', 'ok'))
                .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not enable camera access.'))
            }
          >
            <CameraIcon size={17} /> Enable camera access
          </button>
          <p className="sign-fine">You can revoke this from the Privacy Center at any time.</p>
        </div>
      ) : (
        <div className="sign-grid">
          <section className="sign-camera" aria-label="Camera preview">
            <div
              className={`camera-frame ${streaming ? 'is-live' : ''}`}
              style={frameSize ? { aspectRatio: `${frameSize.width} / ${frameSize.height}` } : undefined}
            >
              <video ref={videoRef} className={streaming ? 'is-live' : ''} muted playsInline aria-label="Live camera preview" />
              {!streaming && (
                <div className="camera-off">
                  <span className="camera-off-icon"><CameraIcon size={30} /></span>
                  <strong>Camera is off</strong>
                  <span>Nothing is captured until you turn it on.</span>
                </div>
              )}
              <span className="camera-live">
                <span className={streaming ? 'live-dot' : 'static-dot'} />
                {streaming ? `On-device · ${INPUT} × ${INPUT}` : 'Paused'}
              </span>
              {streaming && guide && <span className="camera-guide is-tracked" style={guide} aria-hidden="true" />}
            </div>

            <div className={`sign-track ${streaming && signal?.hand && signal.motion <= MAX_MOTION ? 'is-ok' : ''}`}>
              <span className="sign-track-dot" />
              <span>{tracking}</span>
              {streaming && signal && (
                <span className="sign-track-meta">
                  {signal.hand ? `hand ${Math.round(signal.coverage * 100)}%` : 'no hand'} · motion{' '}
                  {Math.round(signal.motion)} · zoom {signal.zoom.toFixed(2)}×
                </span>
              )}
            </div>

            <div className="camera-controls">
              {streaming ? (
                <button type="button" className="button" onClick={stopCamera}>
                  <XIcon size={16} /> Stop camera
                </button>
              ) : (
                <button type="button" className="button button-primary" onClick={() => void startCamera()} disabled={starting}>
                  <CameraIcon size={16} /> {starting ? 'Starting camera…' : 'Turn on camera'}
                </button>
              )}
              <span className="privacy-inline">
                <LockIcon size={14} /> Frames discarded after each inference
              </span>
            </div>

            {error && (
              <div className="inline-alert" role="alert">
                <div>
                  <strong>Camera needs attention</strong>
                  <p>{error}</p>
                </div>
                <button type="button" className="button button-small button-ghost" onClick={() => setError(null)}>
                  Dismiss
                </button>
              </div>
            )}

            <div className="sign-tips">
              <div><span className="tip-num">1</span> Use one hand, palm toward the camera, inside the dashed box.</div>
              <div><span className="tip-num">2</span> Hold each letter still until it appears above, then move to the next.</div>
              <div><span className="tip-num">3</span> Pause for a moment after a word — the pause is what ends the word.</div>
            </div>
          </section>

          <section className="sign-reader" aria-label="Recognised letters">
            <div className="sign-detected">
              <p className="eyebrow">Detected letter</p>
              <div className="detected-glyph" aria-live="polite">{held ?? '—'}</div>
              <div className="confidence-track" aria-hidden="true">
                <span style={{ width: `${confidence}%` }} />
              </div>
              <div className="confidence-meta">
                <span>{prediction ? `${confidence}% confidence` : 'Waiting for a hand sign'}</span>
                <span>{lastMs !== null ? `${lastMs} ms` : 'local'}</span>
              </div>
            </div>

            <div className="sign-alternatives" aria-label="Other likely letters">
              {alternatives.length > 0 ? (
                alternatives.map((item) => (
                  <span key={item.label} className="alternative-chip">
                    {item.label}
                    <small>{Math.round(item.score * 100)}%</small>
                  </span>
                ))
              ) : (
                <span className="muted">Top alternatives appear here.</span>
              )}
            </div>

            <div className="letter-history" aria-label="Accepted letters">
              <span className="letter-history-label">Letters</span>
              {letters.length > 0 ? (
                letters.map((letter, index) => (
                  <span key={`${letter.atMs}-${index}`} className="letter-chip" title={`${Math.round(letter.score * 100)}%`}>
                    {letter.label}
                  </span>
                ))
              ) : (
                <span className="muted">Accepted letters land here.</span>
              )}
            </div>

            <div className="word-builder">
              <div className="word-builder-head">
                <span>Word so far</span>
                <span>{words.length} word{words.length === 1 ? '' : 's'}</span>
              </div>
              <output className="word-output" aria-live="polite">
                {words.length > 0 && <span className="word-done">{words.map((item) => item.text).join(' ')} </span>}
                {draft && <span className="word-draft">{draft}</span>}
                {!words.length && !draft && <span className="muted">—</span>}
              </output>
              <div className="word-actions">
                <button type="button" className="button button-small" onClick={breakWord} disabled={!draft}>
                  Space
                </button>
                <button type="button" className="button button-small" onClick={dropLetter} disabled={!draft}>
                  Backspace
                </button>
                <button
                  type="button"
                  className="button button-small button-ghost"
                  onClick={clearAll}
                  disabled={!draft && words.length === 0}
                >
                  <TrashIcon size={14} /> Clear
                </button>
              </div>
            </div>

            {suggestions.length > 0 && (
              <div className="word-suggestions" aria-label="Suggested spellings">
                <span className="letter-history-label">Did you mean</span>
                {suggestions.map((item) => (
                  <button
                    key={item.word}
                    type="button"
                    className="suggestion-chip"
                    onClick={() => applySuggestion(item.word)}
                    title={`Replace “${draft}” with “${item.word}”`}
                  >
                    {item.word}
                  </button>
                ))}
              </div>
            )}

            {words.length > 0 && (
              <ol className="word-list" aria-label="Recognised words">
                {words.map((item, index) => (
                  <li key={`${item.text}-${index}`}>
                    <span className="word-list-text">{item.text}</span>
                    {item.text.toLowerCase() !== item.raw.toLowerCase() && (
                      <span className="word-list-raw">spelled {item.raw}</span>
                    )}
                    {!item.known && !item.text.toLowerCase().includes(' ') && (
                      <span className="word-list-flag">check spelling</span>
                    )}
                  </li>
                ))}
              </ol>
            )}

            <div className="sign-actions">
              <button type="button" className="button button-primary" onClick={() => void insert()} disabled={!sentence.trim() || inserting}>
                <SendIcon size={16} /> {inserting ? 'Adding…' : 'Add to transcript'}
              </button>
              <button type="button" className="button" onClick={() => speak(sentence)} disabled={!sentence.trim()}>
                <WaveIcon size={16} /> Speak
              </button>
            </div>

            {savedLabel && (
              <p className="sign-saved" role="status">
                <CheckIcon size={15} /> Added <strong>{savedLabel}</strong>
                {active ? ` to ${active.title}` : ''}.
                <button type="button" className="link-button" onClick={() => setView('captions')}>
                  Open transcript
                </button>
              </p>
            )}

            <p className="sign-disclaimer">
              This model recognises <strong>static ASL fingerspelling A–Z</strong> from single frames, then repairs the
              letter runs with an offline dictionary. It is not a full sign-language translator, does not understand
              grammar or motion, and can misread similar hand shapes. Correct a word before you add it.
            </p>
          </section>
        </div>
      )}
    </div>
  )
}
