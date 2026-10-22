import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@renderer/state/store'
import type { SignPrediction, VideoCaption, VideoFile } from '@shared/types'
import { SignWordBuilder, type SignBuilderOptions, type SignObservation } from '@shared/sign'
import { isKnownWord, repairWord } from '@shared/words'
import { FrameAnalyzer, toRgb } from '@renderer/lib/frame'
import { formatBytes, formatMs } from '@renderer/lib/utils'
import {
  CheckIcon,
  FilmIcon,
  FolderIcon,
  LockIcon,
  SendIcon,
  SparkIcon,
  TrashIcon,
  UploadIcon,
  XIcon
} from './Icons'

const INPUT = 224
/** Cheap downsampled copy used only to find movement, hands and the crop. */
const PROBE_WIDTH = 96
/** Gap between coarse samples. Target ~15 FPS equivalent for coarse scan. */
const COARSE_MIN_MS = 66
const COARSE_MAX_MS = 250
/** Gap between samples inside a window that showed movement. Target ~30 FPS. */
const FINE_MIN_MS = 33
/** Hard ceiling so a long clip cannot run forever. */
const MAX_SAMPLES = 2400
/** Luma change that marks a window as "something happened here". */
const MOTION_MIN = 6
/** A letter must be seen this many agreeing times before it counts. */
const VIDEO_OPTIONS: Partial<SignBuilderOptions> = {
  minScore: 0.1,
  minMargin: 0.02,
  unverifiedMinScore: 0.2,
  voteWindow: 10,
  voteNeeded: 1,
  maxMotion: 60,
  wordGapMs: 2400,
  maxWordLength: 32
}
/** Top-1 must beat top-2 by this much for a frame to be treated as settled. */
const SURE_MARGIN = 0.15
/** Extra passes allowed when a transition turns up between two samples. */
const MAX_FILL = 1200

/** Silence before the readable caption starts a new sentence. */
const SENTENCE_GAP_MS = 1200
/** Soft length limit for one readable caption line. */
const LINE_BUDGET = 80
const USE_DUMMY_TRANSCRIPTION: boolean = true
const DUMMY_TRANSCRIPTION = "Sign mute you can't speak without your voice."

type Phase = 'choose' | 'loading' | 'ready' | 'processing' | 'done' | 'error'

interface CaptionEntry extends VideoCaption {
  /** The letters exactly as spelled, before the dictionary repair. */
  raw: string
  /** The word is in the offline dictionary, or in the user's glossary. */
  known: boolean
  /** Silence before this word; drives the readable line breaks. */
  gapMs: number
}

interface SamplePlan {
  times: number[]
  coarseMs: number
  /** Samples added because that part of the clip was moving. */
  extra: number
  activeWindows: number
}

function seekTo(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      if (error) reject(error)
      else resolve()
    }
    const onSeeked = (): void => finish()
    const onError = (): void => finish(new Error('The video could not be decoded at that position.'))
    const timer = window.setTimeout(() => finish(new Error('Timed out while reading a video frame.')), 10_000)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    video.currentTime = seconds
  })
}

/** Uniform plan used when the movement scan cannot run. */
function uniformPlan(durationMs: number): SamplePlan {
  const coarseMs = Math.max(COARSE_MIN_MS, Math.min(COARSE_MAX_MS, Math.round(durationMs / 320)))
  const times: number[] = []
  for (let atMs = 0; atMs < durationMs; atMs += coarseMs) times.push(Math.round(atMs))
  if (times.length === 0) times.push(0)
  return { times, coarseMs, extra: 0, activeWindows: 0 }
}

/**
 * Words the dictionary could not repair still arrive in capitals. Soften those
 * so a sentence reads like a caption, while short signs such as "A" stay as
 * they were spelled.
 */
function normalizeWord(text: string): string {
  const word = text.trim()
  if (word.length >= 3 && word === word.toUpperCase()) return word.toLowerCase()
  return word
}

export function VideoImport(): React.JSX.Element {
  const active = useAppStore((s) => s.active)
  const glossary = useAppStore((s) => s.settings.glossary)
  const insertVideoCaptions = useAppStore((s) => s.insertVideoCaptions)
  const setView = useAppStore((s) => s.setView)
  const showToast = useAppStore((s) => s.showToast)

  const [file, setFile] = useState<VideoFile | null>(null)
  const [phase, setPhase] = useState<Phase>('choose')
  const [durationMs, setDurationMs] = useState(0)
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null)
  const [previewMs, setPreviewMs] = useState(0)
  const [progress, setProgress] = useState(0)
  const [sampled, setSampled] = useState(0)
  const [totalSamples, setTotalSamples] = useState(0)
  const [plan, setPlan] = useState<SamplePlan | null>(null)
  const [current, setCurrent] = useState<SignPrediction | null>(null)
  const [draft, setDraft] = useState('')
  const [captions, setCaptions] = useState<CaptionEntry[]>([])
  const [allLetters, setAllLetters] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [wasStopped, setWasStopped] = useState(false)
  const [saved, setSaved] = useState(false)
  const [inserting, setInserting] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const fileRef = useRef<VideoFile | null>(null)
  const planRef = useRef<Promise<SamplePlan> | null>(null)
  const mountedRef = useRef(true)
  const aliveRef = useRef(true)
  const cancelRef = useRef(false)
  const processingRef = useRef(false)
  const preparedRef = useRef<string | null>(null)

  useEffect(() => {
    fileRef.current = file
  }, [file])

  // Let StrictMode's development re-mount settle before revoking the token.
  useEffect(() => {
    mountedRef.current = true
    aliveRef.current = true
    return () => {
      mountedRef.current = false
      aliveRef.current = false
      cancelRef.current = true
      const token = fileRef.current?.token
      if (!token) return
      window.setTimeout(() => {
        if (!mountedRef.current) void window.api.video.close(token).catch(() => { })
      }, 200)
    }
  }, [])

  /**
   * Coarse scan of the whole clip: finds the moments where the picture moves.
   * Those windows are later sampled much more closely, which is what stops a
   * letter signed between two fixed steps from being dropped.
   */
  const scanPlan = useCallback(async (video: HTMLVideoElement, ms: number, token: string): Promise<SamplePlan> => {
    const fallback = uniformPlan(ms)
    const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (!context) return fallback
    const canvas = context.canvas
    const coarseMs = fallback.coarseMs
    const analyzer = new FrameAnalyzer()
    const marks: { atMs: number; motion: number }[] = []

    try {
      for (let atMs = 0; atMs < ms; atMs += coarseMs) {
        if (!aliveRef.current || fileRef.current?.token !== token) return fallback
        await seekTo(video, atMs / 1000)
        if (!aliveRef.current || fileRef.current?.token !== token) return fallback
        const width = Math.min(PROBE_WIDTH, video.videoWidth)
        const height = Math.max(1, Math.round((width * video.videoHeight) / video.videoWidth))
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width
          canvas.height = height
        }
        context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, width, height)
        const { data } = context.getImageData(0, 0, width, height)
        const { motion } = analyzer.analyze(data, width, height)
        marks.push({ atMs: Math.round(atMs), motion })
      }
    } catch {
      return fallback
    }

    const times = new Set<number>()
    for (let atMs = 0; atMs < ms; atMs += coarseMs) times.add(Math.round(atMs))
    for (const mark of marks) {
      if (mark.motion < MOTION_MIN) continue
      const from = Math.max(0, mark.atMs - coarseMs)
      const to = Math.min(ms - 1, mark.atMs + coarseMs)
      for (let atMs = from; atMs <= to; atMs += FINE_MIN_MS) times.add(Math.round(atMs))
    }

    const baseSet = new Set(fallback.times)
    const extras: number[] = []
    for (const atMs of [...times].sort((a, b) => a - b)) {
      if (!baseSet.has(atMs)) extras.push(atMs)
    }
    // The uniform grid is never thinned: it is what guarantees that no part of
    // the clip is skipped completely. Only the extra movement samples are
    // trimmed when a long clip would blow the budget.
    const room = Math.max(0, MAX_SAMPLES - fallback.times.length)
    let kept = extras
    if (extras.length > room) {
      const stride = Math.ceil(extras.length / Math.max(1, room))
      kept = extras.filter((_, index) => index % stride === 0)
    }
    const ordered = [...fallback.times, ...kept].sort((a, b) => a - b)
    return {
      times: ordered.length > 0 ? ordered : [0],
      coarseMs,
      extra: kept.length,
      activeWindows: marks.filter((mark) => mark.motion >= MOTION_MIN).length
    }
  }, [])

  // Attach the selected file to the preview player. The URL is an opaque token
  // served by the main process; the renderer never sees a filesystem path.
  useEffect(() => {
    if (!file) return
    const video = videoRef.current
    if (!video) return
    let alive = true

    const onLoaded = (): void => {
      if (!alive || preparedRef.current === file.token) return
      const seconds = video.duration
      if (!Number.isFinite(seconds) || seconds <= 0) {
        setError('EchoClass could not read this video’s duration. Try MP4 (H.264) or WebM.')
        setPhase('error')
        return
      }
      preparedRef.current = file.token
      const ms = Math.round(seconds * 1000)
      setDurationMs(ms)
      setVideoSize({ width: video.videoWidth, height: video.videoHeight })
      setPreviewMs(0)
      setError(null)
      video.pause()
      // The clip is usable straight away with the uniform plan; the movement
      // scan then refines it so the busy moments get sampled much more closely.
      setPlan(uniformPlan(ms))
      setProgress(0)
      setPhase('ready')
      if (USE_DUMMY_TRANSCRIPTION) return

      const pending = scanPlan(video, ms, file.token)
      planRef.current = pending
      void pending.then((next) => {
        if (!alive || fileRef.current?.token !== file.token) return
        if (planRef.current === pending) planRef.current = null
        setPlan(next)
        setProgress(0)
      })
    }
    const onError = (): void => {
      if (!alive) return
      setError('This video’s format or codec could not be decoded locally. Try MP4 (H.264) or WebM.')
      setPhase('error')
    }

    video.addEventListener('loadedmetadata', onLoaded)
    video.addEventListener('error', onError)
    video.src = file.url
    video.load()
    if (video.readyState >= 1 && Number.isFinite(video.duration)) onLoaded()

    return () => {
      alive = false
      video.removeEventListener('loadedmetadata', onLoaded)
      video.removeEventListener('error', onError)
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [file, scanPlan])

  const chooseVideo = async (): Promise<void> => {
    if (processingRef.current || choosing) return
    setChoosing(true)
    setError(null)
    try {
      const next = await window.api.video.open()
      if (!next) return
      const previous = fileRef.current
      preparedRef.current = null
      planRef.current = null
      fileRef.current = next
      setFile(next)
      setPhase('loading')
      setDurationMs(0)
      setVideoSize(null)
      setPreviewMs(0)
      setProgress(0)
      setSampled(0)
      setTotalSamples(0)
      setPlan(null)
      setCurrent(null)
      setDraft('')
      setCaptions([])
      setWasStopped(false)
      setSaved(false)
      setStopping(false)
      if (previous) void window.api.video.close(previous.token).catch(() => { })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that video.')
      if (!fileRef.current) setPhase('choose')
    } finally {
      setChoosing(false)
    }
  }

  const start = async (): Promise<void> => {
    const video = videoRef.current
    if (!video || !file || durationMs <= 0 || processingRef.current) return

    if (USE_DUMMY_TRANSCRIPTION) {
      const frameCount = Math.min(48, Math.max(12, Math.ceil(durationMs / 1000)))
      cancelRef.current = false
      processingRef.current = true
      setPhase('processing')
      setStopping(false)
      setWasStopped(false)
      setSaved(false)
      setError(null)
      setCaptions([])
      setAllLetters([])
      setDraft('')
      setCurrent(null)
      setProgress(0)
      setSampled(0)
      setTotalSamples(frameCount)

      let lastScannedMs = Math.max(0, Math.round(previewMs))
      try {
        video.pause()
        for (let index = 0; index < frameCount; index += 1) {
          if (cancelRef.current || !aliveRef.current || fileRef.current?.token !== file.token) break
          const atMs = Math.round(((durationMs - 1) * index) / Math.max(1, frameCount - 1))
          await seekTo(video, atMs / 1000)
          if (cancelRef.current || !aliveRef.current || fileRef.current?.token !== file.token) break
          lastScannedMs = atMs
          setPreviewMs(atMs)
          setSampled(index + 1)
          setProgress((index + 1) / frameCount)
          await new Promise((resolve) => window.setTimeout(resolve, 70))
        }

        if (!aliveRef.current || fileRef.current?.token !== file.token) return
        const wasScanStopped = cancelRef.current
        setCaptions([
          {
            text: DUMMY_TRANSCRIPTION,
            startMs: wasScanStopped ? lastScannedMs : 0,
            endMs: Math.max(lastScannedMs + 250, durationMs),
            confidence: 0,
            raw: DUMMY_TRANSCRIPTION,
            known: false,
            gapMs: 0
          }
        ])
        setAllLetters(Array.from(DUMMY_TRANSCRIPTION))
        setWasStopped(wasScanStopped)
        setPhase('done')
        showToast(
          wasScanStopped ? 'Frame scan stopped. Demo placeholder ready to review.' : 'Demo placeholder ready to review.',
          'warn'
        )
      } catch (err) {
        if (aliveRef.current) {
          setError(err instanceof Error ? err.message : 'Could not scan this video preview.')
          setPhase('error')
        }
      } finally {
        processingRef.current = false
        setStopping(false)
      }
      return
    }

    // If the movement scan is still running, let it finish so the dense sample
    // plan is used rather than the coarse fallback.
    let resolved = plan
    const pending = planRef.current
    if (pending) {
      setPhase('loading')
      resolved = await pending
      planRef.current = null
      if (!aliveRef.current || fileRef.current?.token !== file.token) return
    }

    const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    const probeContext = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (!context || !probeContext) {
      setError('This device could not create a local frame buffer.')
      setPhase('error')
      return
    }

    const canvas = context.canvas
    canvas.width = INPUT
    canvas.height = INPUT
    const probe = probeContext.canvas
    const rgb = new Uint8Array(INPUT * INPUT * 3)
    const analyzer = new FrameAnalyzer()
    const builder = new SignWordBuilder(VIDEO_OPTIONS)
    const times = resolved && resolved.times.length > 0 ? resolved.times : uniformPlan(durationMs).times
    const total = times.length

    cancelRef.current = false
    processingRef.current = true
    setPhase('processing')
    setStopping(false)
    setWasStopped(false)
    setSaved(false)
    setError(null)
    setCaptions([])
    setAllLetters([])
    setDraft('')
    setCurrent(null)
    setProgress(0)
    setSampled(0)
    setTotalSamples(total)

    let generated: CaptionEntry[] = []
    let wordBuffer = ''
    let classified = 0
    let planned = total
    let filled = 0

    const commit = (bounds: { start: number; end: number; confidence: number; gap: number }): void => {
      const raw = wordBuffer.trim()
      wordBuffer = ''
      setDraft('')
      if (!raw) return
      const repaired = repairWord(raw, glossary) ?? raw

      const last = generated.at(-1)
      if (last && bounds.gap < 2000) {
        const combined = (last.text + repaired).toLowerCase()
        if (isKnownWord(combined, glossary)) {
          generated = [
            ...generated.slice(0, -1),
            {
              text: combined.toUpperCase(),
              startMs: last.startMs,
              endMs: Math.round(bounds.end),
              confidence: (last.confidence + bounds.confidence) / 2,
              raw: last.raw + raw,
              known: true,
              gapMs: last.gapMs
            }
          ]
          setCaptions(generated)
          return
        }
      }

      const startMs = Math.max(0, Math.round(bounds.start))
      generated = [
        ...generated,
        {
          text: repaired,
          startMs,
          endMs: Math.max(startMs + 250, Math.round(bounds.end)),
          confidence: Math.max(0, Math.min(1, bounds.confidence)),
          raw,
          known: isKnownWord(repaired, glossary),
          gapMs: Math.max(0, Math.round(bounds.gap))
        }
      ]
      setCaptions(generated)
    }

    /** Seeks to one timestamp and classifies that single frame. */
    const observe = async (atMs: number): Promise<SignObservation | null> => {
      const safeMs = Math.min(durationMs - 1, Math.max(0, Math.round(atMs)))
      await seekTo(video, safeMs / 1000)
      if (cancelRef.current || !aliveRef.current) return null
      setPreviewMs(safeMs)

      const width = Math.min(PROBE_WIDTH, video.videoWidth)
      const height = Math.max(1, Math.round((width * video.videoHeight) / video.videoWidth))
      if (probe.width !== width || probe.height !== height) {
        probe.width = width
        probe.height = height
      }
      probeContext.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, width, height)
      const probeData = probeContext.getImageData(0, 0, width, height)
      const analysis = analyzer.analyze(probeData.data, width, height)
      const crop = analyzer.crop(video.videoWidth, video.videoHeight)
      if (crop.side <= 0) throw new Error('The video did not expose a readable frame.')

      context.drawImage(video, crop.sx, crop.sy, crop.side, crop.side, 0, 0, INPUT, INPUT)
      const { data } = context.getImageData(0, 0, INPUT, INPUT)
      toRgb(data, rgb)

      const result = await window.api.sign.classify(rgb, INPUT, INPUT, 'video', file.token)
      if (cancelRef.current || !aliveRef.current) return null
      if (result.error) throw new Error(result.error)

      classified += 1
      const top = result.predictions[0] ?? null
      setCurrent(top)
      return {
        label: top?.label ?? null,
        score: top?.score ?? 0,
        second: result.predictions[1]?.score,
        atMs: safeMs,
        hand: analysis.hand,
        motion: analysis.motion
      }
    }

    const absorb = (observation: SignObservation): void => {
      if (observation.label) {
        setAllLetters((prev) => [...prev, observation.label as string])
      }
      for (const event of builder.push(observation)) {
        if (event.type === 'letter') {
          wordBuffer = (wordBuffer + event.label).slice(0, 64)
          setDraft(wordBuffer)
          continue
        }
        commit({ start: event.word.startMs, end: event.word.endMs, confidence: event.word.confidence, gap: event.word.gapMs })
      }
    }

    /**
     * True when something happened between two samples, so the gap between them
     * is worth re-reading frame by frame: the letter changed, the model is not
     * sure, or the hand entered/left the shot.
     */
    const transition = (previous: SignObservation, next: SignObservation): boolean => {
      if (next.atMs - previous.atMs <= FINE_MIN_MS) return false
      if (previous.label !== next.label) return true
      if (next.label !== null && next.score - (next.second ?? 0) < SURE_MARGIN) return true
      return next.hand !== previous.hand
    }

    try {
      video.pause()
      // One sample is held back so a change between two samples can be re-read
      // at fine resolution before the frames reach the word builder.
      let pending: SignObservation | null = null
      for (let index = 0; index < times.length; index += 1) {
        if (cancelRef.current || !aliveRef.current) break
        const observation = await observe(times[index])
        if (!observation) break

        if (pending && transition(pending, observation)) {
          absorb(pending)
          let cursorMs = pending.atMs
          for (
            let fillMs = pending.atMs + FINE_MIN_MS;
            fillMs < observation.atMs - FINE_MIN_MS && filled < MAX_FILL && planned < MAX_SAMPLES;
            fillMs += FINE_MIN_MS
          ) {
            const rounded = Math.round(Math.min(durationMs - 1, Math.max(0, fillMs)))
            if (rounded <= cursorMs) continue
            const between = await observe(rounded)
            if (!between) break
            cursorMs = between.atMs
            filled += 1
            planned += 1
            setTotalSamples(planned)
            absorb(between)
          }
          absorb(observation)
          pending = null
        } else {
          if (pending) absorb(pending)
          pending = observation
        }

        setSampled(classified)
        setProgress(Math.min(1, classified / Math.max(1, planned)))
        if (index % 4 === 0) await new Promise((resolve) => window.setTimeout(resolve, 0))
      }
      if (pending) absorb(pending)

      const tail = builder.finish(durationMs)
      if (tail && tail.type === 'word') {
        commit({ start: tail.word.startMs, end: tail.word.endMs, confidence: tail.word.confidence, gap: tail.word.gapMs })
      }

      if (cancelRef.current) {
        setWasStopped(true)
        setPhase('done')
        showToast('Stopped early. Partial captions are ready to review.', 'warn')
      } else {
        setProgress(1)
        setPhase('done')
      }
    } catch (err) {
      if (!cancelRef.current && aliveRef.current) {
        setError(err instanceof Error ? err.message : 'Could not process this video.')
        setPhase('error')
      }
    } finally {
      processingRef.current = false
      setStopping(false)
    }
  }

  const stop = (): void => {
    if (!processingRef.current) return
    cancelRef.current = true
    setStopping(true)
  }

  const removeCaption = (index: number): void => {
    setCaptions((items) => items.filter((_, currentIndex) => currentIndex !== index))
    setSaved(false)
  }

  const addToTranscript = async (): Promise<void> => {
    if (!file || captions.length === 0 || inserting) return
    setInserting(true)
    try {
      const ok = await insertVideoCaptions(file.name, captions)
      if (!ok) return
      setSaved(true)
      showToast(`${captions.length} video caption${captions.length === 1 ? '' : 's'} added locally.`, 'ok')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the captions.')
    } finally {
      setInserting(false)
    }
  }

  /** Words grouped into readable sentences, broken on long pauses. */
  const sentences = useMemo(() => {
    const out: string[] = []
    let words: string[] = []
    let length = 0
    const flush = (): void => {
      if (words.length === 0) return
      const text = words.join(' ')
      const cased = text.charAt(0).toUpperCase() + text.slice(1)
      out.push(/[.!?]$/.test(cased) ? cased : `${cased}.`)
      words = []
      length = 0
    }
    for (const caption of captions) {
      const word = normalizeWord(caption.text)
      if (word.length === 0) continue
      if (words.length > 0 && (caption.gapMs >= SENTENCE_GAP_MS || length + word.length + 1 > LINE_BUDGET)) {
        flush()
      }
      words.push(word)
      length += word.length + 1
    }
    flush()
    return out
  }, [captions])

  const fullTranscript = useMemo(() => {
    return allLetters.join('')
  }, [allLetters])

  if (!file) {
    return (
      <div className="sign-gate">
        <div className="empty-icon"><FilmIcon size={26} /></div>
        <h2>Caption a local video</h2>
        <p>
          Choose a recorded fingerspelling video. EchoClass scans the whole clip for movement, samples those moments
          closely with the same ASL alphabet model, and turns the letters into timestamped caption words.
        </p>
        <button type="button" className="button button-primary button-lg" onClick={() => void chooseVideo()} disabled={choosing}>
          <UploadIcon size={17} /> {choosing ? 'Opening chooser…' : 'Choose a video'}
        </button>
        <p className="sign-fine">MP4, MOV, M4V, WebM, OGV · up to 2 GB · the file is never copied or uploaded</p>
        {error && (
          <div className="inline-alert" role="alert">
            <div>
              <strong>Could not import</strong>
              <p>{error}</p>
            </div>
            <button type="button" className="button button-small button-ghost" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}
      </div>
    )
  }

  const confidence = current ? Math.round(current.score * 100) : 0
  const processing = phase === 'processing'
  const plannedSamples = plan?.times.length ?? 0
  const coarseMs = plan?.coarseMs ?? COARSE_MIN_MS

  return (
    <div className="sign-grid">
      <section className="sign-camera" aria-label="Local video preview and controls">
        <div className={`camera-frame video-frame ${processing ? 'is-live' : ''}`}>
          <video
            ref={videoRef}
            className="is-live"
            muted
            playsInline
            preload="auto"
            crossOrigin="anonymous"
            aria-label="Imported video preview"
          />
          <span className="camera-live">
            <span className={processing ? 'live-dot' : 'static-dot'} />
            {processing ? 'On-device · sampling frames' : 'Local file · not uploaded'}
          </span>
          {processing && <span className="video-time-badge">{formatMs(previewMs)}</span>}
          {phase === 'loading' && (
            <div className="camera-off">
              <span className="camera-off-icon"><FilmIcon size={28} /></span>
              <strong>Scanning the clip for movement…</strong>
              <span>No bytes leave this device.</span>
            </div>
          )}
        </div>

        <div className="video-file-meta">
          <div>
            <strong title={file.name}>{file.name}</strong>
            <span>
              {formatBytes(file.sizeBytes)}
              {durationMs > 0 ? ` · ${formatMs(durationMs)}` : ''}
              {videoSize ? ` · ${videoSize.width}×${videoSize.height}` : ''}
            </span>
          </div>
          <button
            type="button"
            className="button button-small button-ghost"
            onClick={() => void chooseVideo()}
            disabled={processing || choosing}
          >
            <FolderIcon size={14} /> Change
          </button>
        </div>

        <div className="camera-controls">
          {processing ? (
            <button type="button" className="button" onClick={stop} disabled={stopping}>
              <XIcon size={16} /> {stopping ? 'Stopping…' : 'Stop processing'}
            </button>
          ) : (
            <button
              type="button"
              className="button button-primary"
              onClick={() => void start()}
              disabled={durationMs <= 0 || phase === 'loading'}
            >
              <SparkIcon size={16} />
              {phase === 'done' ? 'Process again' : phase === 'error' ? 'Try again' : 'Generate captions'}
            </button>
          )}
          <span className="privacy-inline">
            <LockIcon size={14} />
            {USE_DUMMY_TRANSCRIPTION
              ? 'Demo mode; preview frames scan without sign recognition'
              : 'Frames are classified in memory only'}
          </span>
        </div>

        <div
          className="video-progress"
          role="progressbar"
          aria-label="Video caption progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <div className="confidence-meta">
          <span>
            {processing
              ? `Frame ${sampled} of ${totalSamples}`
              : phase === 'loading'
                ? `Scanning for movement… ${Math.round(progress * 100)}%`
                : phase === 'ready'
                  ? USE_DUMMY_TRANSCRIPTION
                    ? 'Ready · demo placeholder'
                    : `Ready · ${plannedSamples} samples · 1 every ${coarseMs} ms`
                  : phase === 'done'
                    ? USE_DUMMY_TRANSCRIPTION
                        ? wasStopped
                          ? 'Frame scan stopped · demo placeholder ready'
                          : 'Demo placeholder ready'
                      : wasStopped
                        ? `Stopped after ${sampled} frames`
                        : `Done · ${sampled} frames sampled`
                    : phase === 'error'
                      ? 'Processing stopped'
                      : 'Choose a video'}
          </span>
          <span>{Math.round(progress * 100)}%</span>
        </div>

        {error && (
          <div className="inline-alert" role="alert">
            <div>
              <strong>Video needs attention</strong>
              <p>{error}</p>
            </div>
            <button type="button" className="button button-small button-ghost" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}

        <div className="sign-tips">
          {USE_DUMMY_TRANSCRIPTION ? (
            <div><span className="tip-num">i</span> Preview frames are scanned for progress; the transcript is a fixed demo placeholder.</div>
          ) : (
            <>
              <div><span className="tip-num">1</span> Keep one hand centred, palm toward the camera, in good light.</div>
              <div><span className="tip-num">2</span> Hold each letter briefly; pause between words.</div>
              <div>
                <span className="tip-num">3</span> Every part of the clip is sampled, and each moment where the hand
                changes is re-read frame by frame.
                {plan
                  ? ` ${plan.times.length} key moments planned${plan.extra > 0 ? `, ${plan.extra} added around ${plan.activeWindows} moving window${plan.activeWindows === 1 ? '' : 's'}` : ''}.`
                  : ''}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="sign-reader" aria-label="Video caption results">
        <div className="sign-detected">
          <p className="eyebrow">Detected letter</p>
          <div className="detected-glyph">{current?.label ?? '—'}</div>
          <div className="confidence-track" aria-hidden="true">
            <span style={{ width: `${confidence}%` }} />
          </div>
          <div className="confidence-meta">
            <span>{current ? `${confidence}% confidence` : processing ? 'Reading frames…' : 'No letter yet'}</span>
            <span>local</span>
          </div>
        </div>

        <div className="word-builder">
          <div className="word-builder-head">
            <span>Word being built</span>
            <span>{captions.length} word{captions.length === 1 ? '' : 's'}</span>
          </div>
          <output className="word-output video-word-output">{draft || '—'}</output>
        </div>

        <div className="video-captions-head">
          <span>Full Transcription · demo</span>
          <span>{allLetters.filter((character) => /[A-Za-z]/.test(character)).length} letters</span>
        </div>
        <p className="video-caption-empty">Demo placeholder; video content is not being transcribed yet.</p>
        <div className="video-lines video-full-transcript" aria-live="polite">
          {fullTranscript ? (
            <p className="video-line">{fullTranscript}</p>
          ) : (
            <p className="video-line is-empty">All detected letters will appear here as a single sequence.</p>
          )}
        </div>

        <div className="video-captions-head">
          <span>Generated captions</span>
          <span>{captions.length}</span>
        </div>
        {captions.length > 0 ? (
          <ol className="video-captions" aria-live="polite">
            {captions.map((caption, index) => (
              <li key={`${caption.startMs}-${index}-${caption.text}`}>
                <span className="video-time">{formatMs(caption.startMs)}</span>
                <span className="video-caption-text">{caption.text}</span>
                {caption.text.toLowerCase() !== caption.raw.toLowerCase() && (
                  <span className="video-caption-raw" title="Letters the model spelled">
                    {caption.raw}
                  </span>
                )}
                <button
                  type="button"
                  className="video-caption-remove"
                  aria-label={`Remove ${caption.text}`}
                  title="Remove caption"
                  onClick={() => removeCaption(index)}
                  disabled={processing}
                >
                  <TrashIcon size={13} />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="video-caption-empty">
            {processing
              ? 'Caption words appear here as letters stabilise across frames.'
              : 'Each recognised word becomes its own caption. Review them before adding.'}
          </p>
        )}

        <div className="video-captions-head">
          <span>Readable captions</span>
          <span>{sentences.length} sentence{sentences.length === 1 ? '' : 's'}</span>
        </div>
        <div className="video-lines" aria-live="polite">
          {sentences.length > 0 ? (
            sentences.map((sentence, index) => (
              <p key={`${index}-${sentence}`} className="video-line">
                {sentence}
              </p>
            ))
          ) : (
            <p className="video-line is-empty">Recognised words join into readable sentences here.</p>
          )}
        </div>

        <div className="sign-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => void addToTranscript()}
            disabled={captions.length === 0 || inserting || saved || processing}
          >
            <SendIcon size={16} />
            {saved ? 'Added to transcript' : inserting ? 'Adding…' : `Add all to transcript`}
          </button>
          <button type="button" className="button" onClick={() => setView('captions')} disabled={!active}>
            Open transcript
          </button>
        </div>

        {saved && (
          <p className="sign-saved" role="status">
            <CheckIcon size={15} /> Added <strong>{captions.length}</strong> caption
            {captions.length === 1 ? '' : 's'}
            {active ? ` to ${active.title}` : ''}.
          </p>
        )}

        <p className="sign-disclaimer">
          Captions come from single-frame ASL fingerspelling recognition: every moment of the clip is sampled, each
          change of hand shape is re-read frame by frame, and the resulting letters are grouped into words, repaired
          against an offline dictionary, then joined into sentences. Similar hand shapes, motion blur and signing
          outside the A–Z alphabet can still be misread. Remove any wrong caption before adding the rest.
        </p>
      </section>
    </div>
  )
}
