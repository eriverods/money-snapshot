// ─── SHARED ENVELOPE + CATEGORY CHIP PICKERS ──────────────────────────────────
// Used by the Add-transaction modal, the universal tap-to-edit sheets, and the
// inbox "other…" picker so the controls look and behave identically everywhere.
//
// Design rules honoured here:
//   • Color is never the only signal — every chip pairs its dot/emoji with a text
//     label, and selected/suggested states also carry words ("Suggested", a ring).
//   • The catchall ("Whatever") is always the final envelope chip (dashed border).
//   • Theme tokens only (CSS vars); no clinical red.
//   • Reduced motion: these chips use no transitions/animation at all.

import { useT } from './i18n'

const C = {
  surface:     'var(--c-surface)',
  surfaceHigh: 'var(--c-surface-hi)',
  border:      'var(--c-border)',
  text:        'var(--c-text)',
  textMid:     'var(--c-text-mid)',
  textLow:     'var(--c-text-low)',
  purple:      'var(--c-accent)',
}

// A color dot — ALWAYS rendered next to a text label by the chip, never alone.
function Dot({ color, size = 8 }) {
  return <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: color || C.textLow }} />
}

function Chip({ selected, suggested, dashed, emoji, color, label, onClick }) {
  const ringColor = selected ? C.purple : suggested ? C.purple : C.border
  return (
    <button type="button" onClick={onClick} aria-pressed={selected}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: selected || suggested ? C.surfaceHigh : 'transparent',
        border: `1px ${dashed ? 'dashed' : 'solid'} ${ringColor}`,
        boxShadow: selected ? `inset 0 0 0 1px ${C.purple}` : 'none',
        borderRadius: 16, padding: '5px 10px', cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 12, fontWeight: selected ? 700 : 400,
        color: selected || suggested ? C.purple : C.text,
      }}>
      {emoji ? <span style={{ fontSize: 12 }}>{emoji}</span> : color ? <Dot color={color} /> : null}
      <span>{label}</span>
    </button>
  )
}

// Envelope picker. `value` is the selected envelope id ('' = none / sort later).
// Real envelopes first, the catchall last. `suggestedId` highlights the merchant
// hint's pick when nothing is selected yet.
export function EnvelopePicker({ envelopes, value, suggestedId, onChange, includeNone = true }) {
  const { t } = useT()
  const real = (envelopes || []).filter(e => !e.is_catchall)
  const cat = (envelopes || []).filter(e => e.is_catchall)
  const ordered = [...real, ...cat]
  const v = value ? String(value) : ''
  return (
    <div role="group" aria-label={t('env.pick_envelope')} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {includeNone && (
        <Chip selected={!v} dashed label={t('env.pick_none')} onClick={() => onChange('')} />
      )}
      {ordered.map(e => (
        <Chip key={e.id}
          selected={v === String(e.id)}
          suggested={!v && String(suggestedId) === String(e.id)}
          dashed={!!e.is_catchall}
          emoji={e.emoji} color={e.emoji ? null : e.color}
          label={e.name}
          onClick={() => onChange(String(e.id))} />
      ))}
    </div>
  )
}

// Category picker — optional / skippable. Pass the categories already filtered to
// the chosen envelope. `value` is the selected category name ('' = none).
export function CategoryPicker({ categories, value, onChange }) {
  const { t } = useT()
  if (!categories || categories.length === 0) return null
  return (
    <div role="group" aria-label={t('tx.category')} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      <Chip selected={!value} dashed label={t('tx.none')} onClick={() => onChange('')} />
      {categories.map(c => (
        <Chip key={c.id || c.name} selected={value === c.name} label={c.name} onClick={() => onChange(c.name)} />
      ))}
    </div>
  )
}
