// ─── ENVELOPE NAME SANITIZATION ──────────────────────────────────────────────
// Envelope names accept any UTF-8 — emoji, accents, scripts. We only trim
// surrounding whitespace and cap the *visible* length by grapheme count so an
// emoji (often several code units) counts as one character. There are NO
// character-class restrictions, and merchant normalization must never be
// applied to a name (that is for matching merchants, not for display labels).

export const ENVELOPE_NAME_MAX = 40

// Count user-perceived characters (graphemes), so "🌮" or "👨‍👩‍👧" is one.
export function graphemeLength(str) {
  if (!str) return 0
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    let n = 0
    for (const _ of seg.segment(str)) n++
    return n
  }
  // Fallback: code points (still better than UTF-16 units for surrogate pairs).
  return Array.from(str).length
}

// Trim to a max grapheme count without splitting a grapheme cluster.
function truncateGraphemes(str, max) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    let out = ''
    let n = 0
    for (const { segment } of seg.segment(str)) {
      if (n >= max) break
      out += segment
      n++
    }
    return out
  }
  return Array.from(str).slice(0, max).join('')
}

// Returns a clean, saveable name (trimmed, length-capped) or '' if empty.
// Any UTF-8 content is preserved verbatim — no filtering of emoji or symbols.
export function sanitizeEnvelopeName(raw, max = ENVELOPE_NAME_MAX) {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return ''
  if (graphemeLength(trimmed) <= max) return trimmed
  return truncateGraphemes(trimmed, max).trim()
}

export function isValidEnvelopeName(raw) {
  return sanitizeEnvelopeName(raw).length > 0
}
