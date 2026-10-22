/**
 * Letter → word state machine shared by the live camera and the video import.
 *
 * The model answers one frame at a time, and a single frame is easy to get
 * wrong: a blurry transition, an empty room, or an off-centre hand all still
 * produce a confident-looking letter. This builder only accepts a letter when
 *
 *   1. the frame is confident (and clearly beats the runner-up),
 *   2. the frame is not mid-motion (the hand has settled), and
 *   3. the same letter wins a majority of a short voting window,
 *
 * then holds that letter once until the hand changes or leaves. A pause in the
 * letter stream ends the word, which is what turns letters into words.
 *
 * Pure: no DOM, no timers, no I/O — so both pipelines behave identically and
 * the logic is unit-testable.
 */

export interface SignObservation {
    /** Top label for this frame, or null when nothing was classified. */
    label: string | null
    /** Confidence of `label`, 0..1. */
    score: number
    /** Confidence of the runner-up label, used as a margin check. */
    second?: number
    atMs: number
    /** A hand/foreground was plausibly detected in this frame. */
    hand: boolean
    /** Mean frame change since the previous sample, 0..255. */
    motion?: number
}

export interface SignLetter {
    label: string
    atMs: number
    score: number
}

export interface SignWord {
    text: string
    startMs: number
    endMs: number
    confidence: number
    /** Silence before this word, used by the UI to decide line breaks. */
    gapMs: number
}

export type SignEvent =
    | { type: 'letter'; label: string; atMs: number; score: number }
    | { type: 'word'; word: SignWord }

export interface SignBuilderOptions {
    /** Confidence needed when a hand is in view. */
    minScore: number
    /** Top-1 must beat top-2 by this much. */
    minMargin: number
    /** Stricter bar for frames where no hand was detected. */
    unverifiedMinScore: number
    /** How many recent frames vote. */
    voteWindow: number
    /** How many of them must agree to lock a letter. */
    voteNeeded: number
    /** Frames changing more than this are treated as mid-motion. */
    maxMotion: number
    /** Silence that ends a word. */
    wordGapMs: number
    maxWordLength: number
}

export const DEFAULT_SIGN_OPTIONS: SignBuilderOptions = {
    minScore: 0.5,
    minMargin: 0.15,
    unverifiedMinScore: 0.72,
    voteWindow: 5,
    voteNeeded: 3,
    maxMotion: 16,
    wordGapMs: 800,
    maxWordLength: 32
}

interface Vote {
    label: string
    count: number
    score: number
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

export class SignWordBuilder {
    private readonly options: SignBuilderOptions
    private window: ({ label: string; score: number } | null)[] = []
    private locked: string | null = null
    private current = ''
    private currentStart = 0
    private currentScore = 0
    private lastAcceptedMs: number | null = null
    private lastWordEndMs = 0
    private readonly letterLog: SignLetter[] = []
    private readonly wordLog: SignWord[] = []

    constructor(options: Partial<SignBuilderOptions> = {}) {
        this.options = { ...DEFAULT_SIGN_OPTIONS, ...options }
    }

    /** Letters committed so far, in order. */
    get letters(): readonly SignLetter[] {
        return this.letterLog
    }

    /** Words completed so far, in order. */
    get words(): readonly SignWord[] {
        return this.wordLog
    }

    /** The word currently being built. */
    get word(): string {
        return this.current
    }

    /** True while a letter is locked, i.e. the app is waiting for the hand to move. */
    get holding(): boolean {
        return this.locked !== null
    }

    /** Every word joined into one readable line. */
    get text(): string {
        return this.wordLog.map((word) => word.text).join(' ')
    }

    push(observation: SignObservation): SignEvent[] {
        const events: SignEvent[] = []
        const options = this.options
        const moving = (observation.motion ?? 0) > options.maxMotion
        const bar = observation.hand ? options.minScore : options.unverifiedMinScore
        const margin = observation.second === undefined ? Infinity : observation.score - observation.second
        const accepted =
            observation.label !== null && observation.score >= bar && margin >= options.minMargin && !moving

        if (this.lastAcceptedMs === null) this.lastAcceptedMs = observation.atMs

        // A long enough pause in the letter stream finishes the word. The gap is
        // measured from the last letter the model actually accepted, so a slow
        // hand transition does not split a word in half.
        if (this.current.length > 0 && observation.atMs - this.lastAcceptedMs >= options.wordGapMs) {
            const flushed = this.flush(this.lastAcceptedMs + Math.min(320, options.wordGapMs / 2))
            if (flushed) events.push({ type: 'word', word: flushed })
        }

        this.window.push(accepted ? { label: observation.label as string, score: observation.score } : null)
        if (this.window.length > options.voteWindow) this.window.shift()

        if (accepted) {
            this.lastAcceptedMs = observation.atMs
            if (this.current.length > 0 && observation.score > this.currentScore) {
                this.currentScore = observation.score
            }
        }

        const winner = this.vote()
        if (!winner || winner.count < options.voteNeeded || winner.label === this.locked) return events

        this.locked = winner.label
        if (this.current.length === 0) {
            this.currentStart = observation.atMs
            this.currentScore = winner.score
        } else if (winner.score > this.currentScore) {
            this.currentScore = winner.score
        }
        this.current += winner.label

        const letter: SignLetter = { label: winner.label, atMs: observation.atMs, score: winner.score }
        this.letterLog.push(letter)
        events.push({ type: 'letter', label: letter.label, atMs: letter.atMs, score: letter.score })

        if (this.current.length >= options.maxWordLength) {
            const flushed = this.flush(observation.atMs)
            if (flushed) events.push({ type: 'word', word: flushed })
        }
        return events
    }

    /** Flushes the word in progress. Safe to call at the end of a stream. */
    finish(endMs: number): SignEvent | null {
        const end = this.lastAcceptedMs === null ? endMs : Math.max(this.lastAcceptedMs, endMs)
        const flushed = this.flush(end)
        return flushed ? { type: 'word', word: flushed } : null
    }

    reset(): void {
        this.window = []
        this.locked = null
        this.current = ''
        this.currentStart = 0
        this.currentScore = 0
        this.lastAcceptedMs = null
        this.lastWordEndMs = 0
        this.letterLog.length = 0
        this.wordLog.length = 0
    }

    private vote(): Vote | null {
        const counts = new Map<string, { count: number; totalScore: number; maxScore: number }>()
        for (let index = this.window.length - 1; index >= 0; index -= 1) {
            const entry = this.window[index]
            if (!entry) continue
            const seen = counts.get(entry.label)
            if (seen) {
                seen.count += 1
                seen.totalScore += entry.score
                if (entry.score > seen.maxScore) seen.maxScore = entry.score
            } else {
                counts.set(entry.label, { count: 1, totalScore: entry.score, maxScore: entry.score })
            }
        }
        let best: Vote | null = null
        for (const [label, { count, totalScore, maxScore }] of counts) {
            // Confidence-weighted voting: sum of scores must beat a threshold,
            // or count must beat the majority.
            if (!best || totalScore > (best as any).totalScore) {
                best = { label, count, score: maxScore } as any
                    ; (best as any).totalScore = totalScore
            }
        }
        return best
    }

    private flush(endMs: number): SignWord | null {
        const text = this.current
        const startMs = this.currentStart
        const confidence = clamp01(this.currentScore)
        this.current = ''
        this.currentStart = 0
        this.currentScore = 0
        this.window = []
        this.locked = null
        if (text.length === 0) return null
        const word: SignWord = {
            text,
            startMs: Math.round(startMs),
            endMs: Math.round(Math.max(startMs + 200, endMs)),
            confidence,
            gapMs: Math.max(0, Math.round(startMs - this.lastWordEndMs))
        }
        this.lastWordEndMs = word.endMs
        this.wordLog.push(word)
        return word
    }
}
