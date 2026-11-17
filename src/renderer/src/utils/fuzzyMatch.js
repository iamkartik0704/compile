// Fuzzy subsequence matcher used by Quick Open (Ctrl+P).
//
// A query matches a target when its characters appear in order. Among all the
// ways they can line up, we pick the alignment with the best score: runs of
// consecutive characters and matches at word starts ("sb" -> "SideBar",
// "side_bar", "side/bar") beat characters scattered through the string.

const NEG = -1e9

const SCORE_MATCH = 16
const BONUS_CONSECUTIVE = 18
const BONUS_AFTER_SLASH = 16
const BONUS_AFTER_SEPARATOR = 13 // _ - space
const BONUS_CAMEL = 11
const BONUS_AFTER_DOT = 8
const BONUS_FIRST_CHAR = 14
const PENALTY_GAP_LEADING = 1
const PENALTY_GAP_INNER = 2
const MAX_LEADING_PENALTY = 12

// Whole-term bonuses applied by scorePath on top of the alignment score.
const BONUS_IN_BASENAME = 60
const BONUS_BASENAME_PREFIX = 40
const BONUS_BASENAME_EXACT = 80

const isLower = (c) => c >= 97 && c <= 122
const isUpper = (c) => c >= 65 && c <= 90
const isDigit = (c) => c >= 48 && c <= 57

function boundaryBonus(target, j) {
  if (j === 0) return BONUS_FIRST_CHAR
  const prev = target.charCodeAt(j - 1)
  const cur = target.charCodeAt(j)
  if (prev === 47 || prev === 92) return BONUS_AFTER_SLASH // / or \
  if (prev === 95 || prev === 45 || prev === 32) return BONUS_AFTER_SEPARATOR
  if (prev === 46) return BONUS_AFTER_DOT
  if (isUpper(cur) && isLower(prev)) return BONUS_CAMEL
  if (isDigit(cur) && !isDigit(prev)) return BONUS_CAMEL
  return 0
}

/** Cheap check that `queryLower` is a subsequence of `targetLower`. */
export function isSubsequence(queryLower, targetLower) {
  let from = 0
  for (let i = 0; i < queryLower.length; i++) {
    from = targetLower.indexOf(queryLower[i], from)
    if (from === -1) return false
    from++
  }
  return true
}

/**
 * Best alignment of `query` inside `target`.
 * @returns {{ score: number, positions: number[] } | null} positions are indices into `target`.
 */
export function fuzzyMatch(query, target) {
  const n = query.length
  const m = target.length
  if (n === 0) return { score: 0, positions: [] }
  if (n > m) return null

  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (!isSubsequence(q, t)) return null

  // D[i][j]: best score with query[i] matched exactly at target[j].
  // M[i][j]: best score for query[0..i] somewhere within target[0..j].
  const D = new Array(n)
  const M = new Array(n)

  for (let i = 0; i < n; i++) {
    const d = (D[i] = new Float64Array(m).fill(NEG))
    const mm = (M[i] = new Float64Array(m).fill(NEG))
    const qc = q.charCodeAt(i)
    let best = NEG

    for (let j = i; j < m; j++) {
      if (t.charCodeAt(j) === qc) {
        let score = NEG
        if (i === 0) {
          score = SCORE_MATCH + boundaryBonus(target, j) - Math.min(j * PENALTY_GAP_LEADING, MAX_LEADING_PENALTY)
        } else if (j > 0) {
          const viaGap = M[i - 1][j - 1] > NEG ? M[i - 1][j - 1] + SCORE_MATCH + boundaryBonus(target, j) : NEG
          const viaRun = D[i - 1][j - 1] > NEG ? D[i - 1][j - 1] + SCORE_MATCH + BONUS_CONSECUTIVE : NEG
          score = Math.max(viaGap, viaRun)
        }
        d[j] = score
        best = Math.max(score, best > NEG ? best - PENALTY_GAP_INNER : NEG)
      } else {
        best = best > NEG ? best - PENALTY_GAP_INNER : NEG
      }
      mm[j] = best
    }
  }

  // Trailing characters after the last match are free, so take the best end column.
  let endJ = -1
  let bestScore = NEG
  for (let j = n - 1; j < m; j++) {
    if (D[n - 1][j] > bestScore) {
      bestScore = D[n - 1][j]
      endJ = j
    }
  }
  if (endJ === -1) return null

  // Walk back through the table to recover which characters were matched.
  const positions = new Array(n)
  let j = endJ
  for (let i = n - 1; i >= 0; i--) {
    positions[i] = j
    if (i === 0) break
    const viaRun = D[i - 1][j - 1] > NEG ? D[i - 1][j - 1] + SCORE_MATCH + BONUS_CONSECUTIVE : NEG
    if (viaRun === D[i][j]) {
      j = j - 1
      continue
    }
    // Arrived via a gap: the previous char sits at the column that produced M[i-1][j-1].
    const want = M[i - 1][j - 1]
    let k = j - 1
    while (k > 0 && !(D[i - 1][k] > NEG && D[i - 1][k] - (j - 1 - k) * PENALTY_GAP_INNER === want)) k--
    j = k
  }

  return { score: bestScore, positions }
}

/**
 * Score a file path against a (possibly multi-word) query.
 * Every space-separated term must match; a term that fits entirely inside the
 * file name outranks one that needs the directory part.
 * @param {string} query raw user query, e.g. "side comp" or "comp/Side"
 * @param {string} path  path shown to the user, with forward slashes
 * @returns {{ score: number, positions: number[] } | null}
 */
export function scorePath(query, path) {
  const terms = query.replace(/\\/g, '/').split(/\s+/).filter(Boolean)
  if (terms.length === 0) return { score: 0, positions: [] }

  const baseStart = path.lastIndexOf('/') + 1
  const base = path.slice(baseStart)
  const baseLower = base.toLowerCase()

  let total = 0
  const seen = new Set()

  for (const term of terms) {
    let best = null

    if (!term.includes('/')) {
      const inBase = fuzzyMatch(term, base)
      if (inBase) {
        let score = inBase.score + BONUS_IN_BASENAME
        const termLower = term.toLowerCase()
        const stem = baseLower.replace(/\.[^.]*$/, '')
        if (baseLower === termLower || stem === termLower) score += BONUS_BASENAME_EXACT
        else if (baseLower.startsWith(termLower)) score += BONUS_BASENAME_PREFIX
        best = { score, positions: inBase.positions.map((p) => p + baseStart) }
      }
    }

    const inPath = fuzzyMatch(term, path)
    if (inPath && (!best || inPath.score > best.score)) best = inPath
    if (!best) return null

    total += best.score
    for (const p of best.positions) seen.add(p)
  }

  // Between equally good matches, prefer the shorter (shallower) path.
  total -= Math.min(path.length, 120) * 0.05

  return { score: total, positions: Array.from(seen).sort((a, b) => a - b) }
}

/**
 * Score a plain label (command name, symbol name) against a multi-word query.
 * Every space-separated term must match.
 * @returns {{ score: number, positions: number[] } | null}
 */
export function scoreLabel(query, label) {
  const terms = query.split(/\s+/).filter(Boolean)
  if (terms.length === 0) return { score: 0, positions: [] }

  let total = 0
  const seen = new Set()
  for (const term of terms) {
    const match = fuzzyMatch(term, label)
    if (!match) return null
    total += match.score
    for (const p of match.positions) seen.add(p)
  }
  total -= Math.min(label.length, 120) * 0.05

  return { score: total, positions: Array.from(seen).sort((a, b) => a - b) }
}

/**
 * Split `text` into alternating plain / matched runs for highlighting.
 * @returns {{ text: string, match: boolean }[]}
 */
export function highlightRuns(text, positions) {
  if (!positions || positions.length === 0) return [{ text, match: false }]
  const hit = new Set(positions)
  const runs = []
  let start = 0
  let current = hit.has(0)
  for (let i = 1; i <= text.length; i++) {
    const next = i < text.length ? hit.has(i) : !current
    if (next !== current) {
      runs.push({ text: text.slice(start, i), match: current })
      start = i
      current = next
    }
  }
  return runs
}
