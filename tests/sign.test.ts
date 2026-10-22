import { describe, expect, it } from 'vitest'
import { DEFAULT_SIGN_OPTIONS, SignWordBuilder, type SignEvent } from '../src/shared/sign'
import { editDistance, isKnownWord, repairWord, spellFix, suggestWords } from '../src/shared/words'
import { FrameAnalyzer, toRgb } from '../src/renderer/src/lib/frame'

const options = {
    ...DEFAULT_SIGN_OPTIONS,
    minScore: 0.5,
    minMargin: 0.15,
    unverifiedMinScore: 0.72,
    voteWindow: 5,
    voteNeeded: 3,
    maxMotion: 16,
    wordGapMs: 800
}

/** Feeds the same confident letter until the voting window locks it. */
function lock(builder: SignWordBuilder, label: string, startMs: number): SignEvent[] {
    const events: SignEvent[] = []
    for (let index = 0; index < options.voteNeeded; index += 1) {
        events.push(
            ...builder.push({ label, score: 0.9, second: 0.1, atMs: startMs + index * 300, hand: true, motion: 2 })
        )
    }
    return events
}

describe('letter -> word builder', () => {
    it('waits for the voting window before locking a letter', () => {
        const builder = new SignWordBuilder(options)
        expect(builder.push({ label: 'A', score: 0.9, second: 0.1, atMs: 0, hand: true, motion: 1 })).toEqual([])
        expect(builder.push({ label: 'A', score: 0.9, second: 0.1, atMs: 300, hand: true, motion: 1 })).toEqual([])
        const events = builder.push({ label: 'A', score: 0.9, second: 0.1, atMs: 600, hand: true, motion: 1 })
        expect(events).toEqual([{ type: 'letter', label: 'A', atMs: 600, score: 0.9 }])
    })

    it('ignores frames that are mid-motion', () => {
        const builder = new SignWordBuilder(options)
        let events: SignEvent[] = []
        for (let index = 0; index < 6; index += 1) {
            events = events.concat(
                builder.push({ label: 'B', score: 0.95, second: 0.05, atMs: index * 300, hand: true, motion: 40 })
            )
        }
        expect(events).toEqual([])
        expect(builder.letters).toHaveLength(0)
    })

    it('rejects a frame that does not clearly beat the runner-up', () => {
        const builder = new SignWordBuilder(options)
        let events: SignEvent[] = []
        for (let index = 0; index < 5; index += 1) {
            events = events.concat(
                builder.push({ label: 'C', score: 0.51, second: 0.48, atMs: index * 300, hand: true, motion: 1 })
            )
        }
        expect(events).toEqual([])
    })

    it('holds a locked letter until the hand changes', () => {
        const builder = new SignWordBuilder(options)
        lock(builder, 'A', 0)
        const repeats = builder.push({ label: 'A', score: 0.9, second: 0.1, atMs: 900, hand: true, motion: 1 })
        expect(repeats).toEqual([])
        expect(builder.letters).toHaveLength(1)
    })

    it('ends the word after a pause and records the gap', () => {
        const builder = new SignWordBuilder(options)
        lock(builder, 'A', 0)
        const events = builder.push({ label: null, score: 0, atMs: 2000, hand: true, motion: 1 })
        expect(events).toHaveLength(1)
        const [event] = events
        expect(event.type).toBe('word')
        if (event.type !== 'word') throw new Error('expected a word')
        expect(event.word.text).toBe('A')
        // The word starts when the first letter is confirmed, not when it is first seen.
        expect(event.word.startMs).toBe(600)
        expect(event.word.endMs).toBeGreaterThanOrEqual(600)
        expect(event.word.confidence).toBeCloseTo(0.9, 5)
    })

    it('assembles several letters into one word', () => {
        const builder = new SignWordBuilder(options)
        let events: SignEvent[] = []
        events = events.concat(lock(builder, 'A', 0))
        events = events.concat(lock(builder, 'B', 1000))
        events = events.concat(builder.push({ label: null, score: 0, atMs: 4000, hand: true, motion: 1 }))
        const word = events.find((event) => event.type === 'word')
        expect(word && word.type === 'word' ? word.word.text : '').toBe('AB')
    })

    it('flushes the trailing word with finish()', () => {
        const builder = new SignWordBuilder(options)
        lock(builder, 'Z', 0)
        const tail = builder.finish(900)
        expect(tail?.type).toBe('word')
        if (tail?.type !== 'word') throw new Error('expected a word')
        expect(tail.word.text).toBe('Z')
        expect(builder.finish(1200)).toBeNull()
    })
})

describe('offline dictionary', () => {
    it('measures bounded edit distance', () => {
        expect(editDistance('water', 'water')).toBe(0)
        expect(editDistance('woter', 'water')).toBe(1)
        expect(editDistance('abc', 'xyzxyzxyz', 2)).toBe(3)
    })

    it('knows common words and single-letter words', () => {
        expect(isKnownWord('water')).toBe(true)
        expect(isKnownWord('a')).toBe(true)
        expect(isKnownWord('i')).toBe(true)
        expect(isKnownWord('woter')).toBe(false)
    })

    it('repairs a one-letter slip on a long enough word', () => {
        expect(spellFix('woter', [])).toBe('water')
    })

    it('leaves real words and very short runs alone', () => {
        expect(spellFix('water', [])).toBeNull()
        expect(spellFix('ab', [])).toBeNull()
    })

    it('ranks the closest dictionary word first', () => {
        const [best] = suggestWords('woter', [], 3)
        expect(best.word).toBe('water')
    })

    it('prefers the user glossary over the built-in list', () => {
        const suggested = suggestWords('eigenvalu', ['eigenvalue'], 3)
        expect(suggested[0].word).toBe('eigenvalue')
    })
})

describe('word repair', () => {
    it('fixes a single wrong letter', () => {
        expect(repairWord('woter', [])).toBe('water')
    })

    it('fixes two letters signed in the wrong order', () => {
        expect(repairWord('taht', [])).toBe('that')
    })

    it('fixes a letter the model held twice', () => {
        expect(repairWord('watter', [])).toBe('water')
    })

    it('fixes one missing letter', () => {
        expect(repairWord('watr', [])).toBe('water')
    })

    it('keeps real words, short runs and hopeless runs as signed', () => {
        expect(repairWord('water', [])).toBeNull()
        expect(repairWord('A', [])).toBeNull()
        expect(repairWord('qxz', [])).toBeNull()
    })

    it('repairs against the glossoped terms too', () => {
        expect(repairWord('eigenvalu', ['eigenvalue'])).toBe('eigenvalue')
    })
})

function frame(width: number, height: number, fill: [number, number, number]): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let index = 0; index < width * height; index += 1) {
        data[index * 4] = fill[0]
        data[index * 4 + 1] = fill[1]
        data[index * 4 + 2] = fill[2]
        data[index * 4 + 3] = 255
    }
    return data
}

describe('frame analysis', () => {
    it('packs RGBA into RGB', () => {
        const target = new Uint8Array(6)
        expect(Array.from(toRgb(new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]), target))).toEqual([
            10, 20, 30, 40, 50, 60
        ])
    })

    it('sees no hand in a flat frame', () => {
        const analyzer = new FrameAnalyzer()
        const analysis = analyzer.analyze(frame(48, 48, [128, 128, 128]), 48, 48)
        expect(analysis.motion).toBe(0)
        expect(analysis.hand).toBe(false)
    })

    it('finds motion, a skin-tone subject, and a tighter crop', () => {
        const analyzer = new FrameAnalyzer()
        analyzer.analyze(frame(48, 48, [128, 128, 128]), 48, 48)

        const data = frame(48, 48, [128, 128, 128])
        for (let y = 18; y < 30; y += 1) {
            for (let x = 12; x < 24; x += 1) {
                const index = (y * 48 + x) * 4
                data[index] = 240
                data[index + 1] = 180
                data[index + 2] = 150
            }
        }
        const analysis = analyzer.analyze(data, 48, 48)
        expect(analysis.motion).toBeGreaterThan(0)
        expect(analysis.hand).toBe(true)
        expect(analysis.coverage).toBeGreaterThan(0)

        const crop = analyzer.crop(48, 48)
        expect(crop.side).toBeGreaterThan(0)
        expect(crop.side).toBeLessThanOrEqual(48)
        expect(crop.sx).toBeGreaterThanOrEqual(0)
        expect(crop.sy).toBeGreaterThanOrEqual(0)
        expect(crop.sx + crop.side).toBeLessThanOrEqual(48)
        expect(crop.sy + crop.side).toBeLessThanOrEqual(48)
    })
})
