/**
 * Offline word layer for fingerspelling.
 *
 * The shipped model classifies static ASL letters (A–Z) one frame at a time,
 * so a run of recognised letters is not yet a word. This module turns that
 * letter stream into words: it recognises dictionary words, ranks near misses
 * as spelling suggestions, and never leaves the process. There is no network
 * call and no model download — the dictionary is a plain in-bundle word list,
 * extended at runtime with the user's own glossary terms.
 */

export interface WordSuggestion {
    word: string
    /** Levenshtein distance from the signed letters. */
    distance: number
    /** 0..1, higher is a better match. */
    score: number
}

/**
 * Common English words used to repair fingerspelled letter runs. Deliberately
 * small and high-frequency: fingerspelling is used for names and jargon, so
 * this list is a spelling aid, not a general lexicon. Short words are included
 * because fingerspelt single letters ("A", "I") are valid words on their own.
 */
const RAW_WORDS = `
a i an as at am be by do go he if in is it me my no of on or so to up us we
add age ago air all and any are arm art ask bad bag bar bed bee big bit box boy
bug bus but buy can car cat cold come cook cop cry cup cut dad day did die dig
dog dry eat egg end eye face fact fair fall far fat fear feel few fill find fine
fire fish fit five fly food foot for four free from full fun game gas get gift
girl give glad go goal gold good got gray grew grow guy had hair half hall hand
happy hard has hat have head hear heat help her here hide high him his hit hold
hole home hope horse hot hour how huge hunt hurt idea ill inch iron item job
join joke jump just keep key kid kill kind king kiss knee knew know lab lack
lady lake lamp land lane large last late laugh law lay lead leaf lean learn
leave left leg less let letter level lie life lift light like line list little
live load local lock long look lose loss lot loud love low luck lump made mail
main make man many map mark market marry match may meal mean meat meet melt
men met middle might mile milk mind mine miss mix model money month moon more
most mother mouth move much music must name near neck need nest never new next
nice night nine no noise none noon north nose not note noun now numb nurse nut
oak odd offer office oil old once one only open or orange order other our out
over own page pain paint pair pale paper park part party pass past path pay
peace pen people per pick picture piece pig pin pink pipe place plan plant
plate play please plus point police pool poor pop port post pot pound power
press pretty price print prize pull pump pure push put quick quiet quit quite
race radio rain raise ran range rate rather raw reach read ready real reason
red rest rice rich ride right ring rise river road rock roll roof room root
rope rose round row rub rule run sad safe said sail salt same sand save saw say
scale school score sea search season seat second see seed seem self sell send
sense sent serve set seven shade shake shall shape share sharp she sheep sheet
shell shelf shine ship shoe shop short should show shut sick side sign silent
silver simple since sing sir sister sit six size skin sky sleep slow small
smart smell smile snow soap soft soil sold some son song soon sort sound soup
south space speak special speed spell spend spoke spoon sport spot spread
spring square staff stage stairs stamp stand star start state stay steam step
stick still stone stood stop store storm story straight strange stream street
stress stretch strong study stuff style subject such sudden sugar summer sun
sure surprise sweet swim table tail take talk tall taste tax tea teach team
tear teeth tell ten term test than thank that their them then there these they
thick thin thing think third this those though thought three throat through
throw thus ticket tie tight time tiny tip tired to today together told
tomorrow tone too took tool top total touch toward town toy track trade train
treat tree trip true trust try tube turn twice two type uncle under until
upon use usual value very view village visit voice wait walk wall want war
warm wash waste watch water wave way weak wear weather week weight welcome
well went were west wet what wheat wheel when where which while white who
whole why wide wife wild will win wind window wine wing winter wire wise wish
with within without woman wonder wood word work world worry would wound write
wrong wrote yard year yellow yes yet you young your
`

const DICTIONARY: readonly string[] = Array.from(
    new Set(
        RAW_WORDS.split(/\s+/)
            .map((word) => word.trim().toLowerCase())
            .filter((word) => /^[a-z]{1,12}$/.test(word))
    )
)

const RANK = new Map<string, number>()
for (let index = 0; index < DICTIONARY.length; index += 1) RANK.set(DICTIONARY[index], index)

/** Extra terms (the user's glossary) are preferred over the built-in list. */
function candidates(extra: readonly string[]): { word: string }[] {
    const list: { word: string }[] = []
    const seen = new Set<string>()
    for (const term of extra) {
        const word = term.trim().toLowerCase()
        if (!/^[a-z]{1,24}$/.test(word) || seen.has(word)) continue
        seen.add(word)
        list.push({ word })
    }
    for (const word of DICTIONARY) {
        if (seen.has(word)) continue
        seen.add(word)
        list.push({ word })
    }
    return list
}

/**
 * Bounded Levenshtein distance. Returns `limit + 1` as soon as the edit
 * distance cannot fit inside the budget, which keeps the scan cheap.
 */
export function editDistance(a: string, b: string, limit = 3): number {
    if (a === b) return 0
    if (Math.abs(a.length - b.length) > limit) return limit + 1
    const previous = new Array<number>(b.length + 1)
    const current = new Array<number>(b.length + 1)
    for (let j = 0; j <= b.length; j += 1) previous[j] = j
    for (let i = 1; i <= a.length; i += 1) {
        current[0] = i
        let best = current[0]
        for (let j = 1; j <= b.length; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1
            current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
            if (current[j] < best) best = current[j]
        }
        if (best > limit) return limit + 1
        for (let j = 0; j <= b.length; j += 1) previous[j] = current[j]
    }
    return previous[b.length]
}

function maxDistanceFor(length: number): number {
    if (length <= 2) return 1
    if (length <= 5) return 2
    return 3
}

/**
 * Ranks dictionary words against a signed letter run. Exact matches come first,
 * then the closest spellings by edit distance, then by word length and
 * frequency. Always returns at most `limit` entries.
 */
export function suggestWords(
    letters: string,
    extra: readonly string[] = [],
    limit = 5
): WordSuggestion[] {
    const input = letters.trim().toLowerCase().replace(/[^a-z]/g, '')
    if (input.length === 0) return []
    const limitDistance = maxDistanceFor(input.length)
    const scored: WordSuggestion[] = []
    for (const { word } of candidates(extra)) {
        if (Math.abs(word.length - input.length) > limitDistance) continue
        const distance = editDistance(input, word, limitDistance)
        if (distance > limitDistance) continue
        const span = Math.max(input.length, word.length)
        const score = Math.max(0, 1 - distance / (span + 1)) * (word.length === input.length ? 1 : 0.92)
        scored.push({ word, distance, score })
    }
    scored.sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score
        return (RANK.get(a.word) ?? Number.MAX_SAFE_INTEGER) - (RANK.get(b.word) ?? Number.MAX_SAFE_INTEGER)
    })
    return scored.slice(0, Math.max(1, limit))
}

/** True when the signed letters already spell a known word exactly. */
export function isKnownWord(letters: string, extra: readonly string[] = []): boolean {
    const input = letters.trim().toLowerCase().replace(/[^a-z]/g, '')
    if (input.length === 0) return false
    if (extra.some((term) => term.trim().toLowerCase() === input)) return true
    if (input.length === 1) return input === 'a' || input === 'i'
    return RANK.has(input)
}

/**
 * Conservative spelling repair: only replaces an unknown word when a single
 * edit produces a dictionary word and the sign is long enough that a one-letter
 * slip is more likely than a genuine short word. Returns null when the word
 * should be left exactly as signed.
 */
export function spellFix(letters: string, extra: readonly string[] = []): string | null {
    const input = letters.trim().toLowerCase().replace(/[^a-z]/g, '')
    if (input.length < 1 || isKnownWord(input, extra)) return null
    if (input.length < 3) return null
    const [best] = suggestWords(input, extra, 1)
    if (!best || best.distance !== 1 || best.word.length !== input.length) return null
    return best.word
}

/** Two neighbouring letters signed in the wrong order — a very common slip. */
function adjacentSwap(letters: string, extra: readonly string[]): string | null {
    for (let index = 0; index + 1 < letters.length; index += 1) {
        const swapped =
            letters.slice(0, index) + letters[index + 1] + letters[index] + letters.slice(index + 2)
        if (isKnownWord(swapped, extra)) return swapped
    }
    return null
}

/** A letter the model held for two frames, e.g. WATTER -> WATER. */
function collapseRepeat(letters: string, extra: readonly string[]): string | null {
    for (let index = 0; index + 1 < letters.length; index += 1) {
        if (letters[index] !== letters[index + 1]) continue
        const collapsed = letters.slice(0, index + 1) + letters.slice(index + 2)
        if (isKnownWord(collapsed, extra)) return collapsed
    }
    return null
}

/**
 * Best-effort repair of a signed letter run, ordered by how safe each fix is:
 * one wrong letter, two swapped neighbours, one repeated letter, then a single
 * missing or extra letter. Returns null when the run should be kept exactly as
 * signed — short runs, or nothing convincing in the dictionary.
 */
export function repairWord(letters: string, extra: readonly string[] = []): string | null {
    const input = letters.trim().toLowerCase().replace(/[^a-z]/g, '')
    if (input.length < 1) return null
    if (isKnownWord(input, extra)) return null
    // Very short signs (1-2 letters) are either names/jargon or already in the
    // dictionary. We only repair them if there is a perfect match (handled above)
    // or if they are long enough to be a common word.
    if (input.length < 3) return null
    const substituted = spellFix(input, extra)
    if (substituted) return substituted
    const swapped = adjacentSwap(input, extra)
    if (swapped) return swapped
    const collapsed = collapseRepeat(input, extra)
    if (collapsed) return collapsed
    for (const suggestion of suggestWords(input, extra, 12)) {
        const maxEdit = input.length <= 3 ? 1 : input.length <= 6 ? 2 : 3
        if (suggestion.distance > maxEdit) continue
        if (suggestion.word.length < 3) continue
        return suggestion.word
    }
    return null
}
