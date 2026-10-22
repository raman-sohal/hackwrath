/**
 * Frame analysis shared by the live camera and the local video import.
 *
 * The shipped model classifies whatever square you hand it, so the whole job
 * of "is there actually a hand here, and where" sits in the renderer. Two
 * things go wrong without it:
 *
 *   - an empty room still produces a confident letter, and
 *   - a hand that is not perfectly centred gets cropped in half.
 *
 * `FrameAnalyzer` watches a cheap downsampled copy of the frame (never the
 * pixels that get classified) and reports how much the picture moved, whether
 * a foreground subject is present, and where to crop next. A tracked crop is
 * only adopted when the detected subject is plausible; otherwise the crop
 * falls back to the plain centre square, which is what the model was trained
 * on. Everything here is in-memory only.
 */

export interface CropRect {
    sx: number
    sy: number
    side: number
}

export interface FrameAnalysis {
    /** Mean absolute luma change since the previous analysed frame, 0..255. */
    motion: number
    /** A hand/foreground subject plausibly occupies the frame. */
    hand: boolean
    /** Fraction of the frame covered by the largest foreground blob. */
    coverage: number
    /** Fraction of the frame matching a skin-tone rule. */
    skin: number
    /** Smoothed crop centre in normalised frame coordinates. */
    centre: { x: number; y: number }
    /** Smoothed crop zoom. 1 keeps the full centre square. */
    zoom: number
}

/** Zoom used before a subject has been located — verified safe on the fixture. */
const DEFAULT_ZOOM = 1.12
const MIN_ZOOM = 1
const MAX_ZOOM = 1.6
/** Luma distance from the background that counts as foreground. */
const BG_DELTA = 26
const MIN_COVERAGE = 0.015
const MAX_COVERAGE = 0.75
/** A blob spanning this much of an axis is treated as "the whole scene". */
const SPAN_LIMIT = 0.94
const SKIN_MIN = 0.015
/** How fast the crop follows the subject. Higher is more reactive, lower is smoother. */
const SMOOTHING = 0.25
/** Extra padding around the subject to ensure hand gestures aren't cut off. */
const PADDING = 1.6

const clamp = (value: number, low: number, high: number): number =>
    value < low ? low : value > high ? high : value

/** YCbCr rule with a loose RGB fallback; tolerant of darker skin tones. */
function isSkin(r: number, g: number, b: number): boolean {
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
    if (cb >= 77 && cb <= 132 && cr >= 132 && cr <= 178 && r > 55 && r > b) return true
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    return r > 90 && g > 35 && b > 15 && max - min > 12 && r - g > 12 && r > b
}

interface Component {
    count: number
    x0: number
    y0: number
    x1: number
    y1: number
}

/** Largest 4-connected blob in a binary mask. Iterative, so it cannot blow the stack. */
function largestComponent(mask: Uint8Array, width: number, height: number): Component | null {
    const seen = new Uint8Array(mask.length)
    const stack = new Int32Array(mask.length)
    let best: Component | null = null
    for (let seed = 0; seed < mask.length; seed += 1) {
        if (mask[seed] === 0 || seen[seed] === 1) continue
        let top = 0
        stack[top++] = seed
        seen[seed] = 1
        let count = 0
        let x0 = width
        let y0 = height
        let x1 = -1
        let y1 = -1
        while (top > 0) {
            const current = stack[--top]
            const x = current % width
            const y = (current - x) / width
            count += 1
            if (x < x0) x0 = x
            if (x > x1) x1 = x
            if (y < y0) y0 = y
            if (y > y1) y1 = y
            if (x > 0 && mask[current - 1] === 1 && seen[current - 1] === 0) {
                seen[current - 1] = 1
                stack[top++] = current - 1
            }
            if (x < width - 1 && mask[current + 1] === 1 && seen[current + 1] === 0) {
                seen[current + 1] = 1
                stack[top++] = current + 1
            }
            if (y > 0 && mask[current - width] === 1 && seen[current - width] === 0) {
                seen[current - width] = 1
                stack[top++] = current - width
            }
            if (y < height - 1 && mask[current + width] === 1 && seen[current + width] === 0) {
                seen[current + width] = 1
                stack[top++] = current + width
            }
        }
        if (!best || count > best.count) best = { count, x0, y0, x1, y1 }
    }
    return best
}

export class FrameAnalyzer {
    private previous: Uint8Array | null = null
    private centreX = 0.5
    private centreY = 0.5
    private zoom = DEFAULT_ZOOM

    /**
     * Reads one RGBA frame (a small downsampled copy of the source) and updates
     * the crop target. `data` is the raw `ImageData.data` of that copy.
     */
    analyze(data: Uint8ClampedArray | Uint8Array, width: number, height: number): FrameAnalysis {
        const count = width * height
        const gray = new Uint8Array(count)
        let skin = 0
        for (let index = 0, source = 0; index < count; index += 1, source += 4) {
            const r = data[source]
            const g = data[source + 1]
            const b = data[source + 2]
            gray[index] = (r * 77 + g * 150 + b * 29) >> 8
            if (isSkin(r, g, b)) skin += 1
        }

        const previous = this.previous
        this.previous = gray
        let motion = 0
        if (previous && previous.length === count) {
            let total = 0
            for (let index = 0; index < count; index += 1) {
                total += Math.abs(gray[index] - previous[index])
            }
            motion = total / count
        }

        // The background is whatever the frame's border ring is made of.
        const border: number[] = []
        for (let x = 0; x < width; x += 1) border.push(gray[x], gray[(height - 1) * width + x])
        for (let y = 0; y < height; y += 1) border.push(gray[y * width], gray[y * width + width - 1])
        border.sort((a, b) => a - b)
        const background = border[border.length >> 1]

        const mask = new Uint8Array(count)
        for (let index = 0; index < count; index += 1) {
            if (Math.abs(gray[index] - background) > BG_DELTA) mask[index] = 1
        }
        const blob = largestComponent(mask, width, height)
        const coverage = blob ? blob.count / count : 0
        const skinRatio = skin / count

        let located = false
        if (blob && coverage >= MIN_COVERAGE && coverage <= MAX_COVERAGE) {
            const blobWidth = blob.x1 - blob.x0 + 1
            const blobHeight = blob.y1 - blob.y0 + 1
            const spans = blobWidth >= width * SPAN_LIMIT || blobHeight >= height * SPAN_LIMIT
            // A blob that fills the frame is the scene itself (a wall, a backlit
            // window), not a subject — ignore it and keep the safe centre crop.
            if (!spans) {
                located = true
                const min = Math.min(width, height)
                const target = (Math.max(blobWidth, blobHeight) * PADDING) / min
                const wantedZoom = clamp(1 / target, MIN_ZOOM, MAX_ZOOM)
                const wantedX = (blob.x0 + blobWidth / 2) / width
                const wantedY = (blob.y0 + blobHeight / 2) / height
                this.centreX = clamp(this.centreX + (wantedX - this.centreX) * SMOOTHING, 0, 1)
                this.centreY = clamp(this.centreY + (wantedY - this.centreY) * SMOOTHING, 0, 1)
                this.zoom = clamp(this.zoom + (wantedZoom - this.zoom) * SMOOTHING, MIN_ZOOM, MAX_ZOOM)
            }
        }
        // No subject in view: ease the crop back to the default framing but keep
        // the last known position, so a hand that briefly leaves is re-found.
        if (!located) this.zoom = this.zoom + (DEFAULT_ZOOM - this.zoom) * 0.2

        return {
            motion,
            hand: located || skinRatio >= SKIN_MIN,
            coverage,
            skin: skinRatio,
            centre: { x: this.centreX, y: this.centreY },
            zoom: this.zoom
        }
    }

    /** Square source rectangle to draw into the 224x224 classification canvas. */
    crop(frameWidth: number, frameHeight: number): CropRect {
        const min = Math.min(frameWidth, frameHeight)
        if (min <= 0) return { sx: 0, sy: 0, side: 0 }
        const wanted = Math.min(min, min / this.zoom)
        const side = Math.max(1, Math.round(wanted))
        const sx = clamp(Math.round(this.centreX * frameWidth - side / 2), 0, Math.max(0, frameWidth - side))
        const sy = clamp(Math.round(this.centreY * frameHeight - side / 2), 0, Math.max(0, frameHeight - side))
        return { sx, sy, side }
    }

    reset(): void {
        this.previous = null
        this.centreX = 0.5
        this.centreY = 0.5
        this.zoom = DEFAULT_ZOOM
    }
}

/** RGBA canvas data → packed RGB, the layout the classification service expects. */
export function toRgb(data: Uint8ClampedArray | Uint8Array, target: Uint8Array): Uint8Array {
    for (let source = 0, out = 0; out < target.length; source += 4, out += 3) {
        target[out] = data[source]
        target[out + 1] = data[source + 1]
        target[out + 2] = data[source + 2]
    }
    return target
}
