import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from './lib/supabase'
import { useT } from './i18n'
import {
  todayStr, periodEndFor, isPeriodOver, daysLeftIn, availableFor,
  computeEnvelopeSpent, computeCloseOut, buildEnvelopeSuggestions, buildCycleSuggestions,
} from './lib/envelopeLogic'
import {
  normalizeMerchant, suggestEnvelopeId, inboxTransactions, relativeDay,
} from './lib/envelopeInbox'

const C = {
  bg:         'var(--c-bg)',
  surface:    'var(--c-surface)',
  surfaceHigh:'var(--c-surface-hi)',
  border:     'var(--c-border)',
  text:       'var(--c-text)',
  textMid:    'var(--c-text-mid)',
  textLow:    'var(--c-text-low)',
  green:      'var(--c-positive)',
  greenBg:    'var(--c-pos-bg)',
  red:        'var(--c-negative)',
  redBg:      'var(--c-neg-bg)',
  orange:     'var(--c-warning)',
  purple:     'var(--c-accent)',
  blue:       'var(--c-info)',
}
const S = {
  card: { background: C.surface, borderRadius: 14, padding: 14, marginBottom: 12, border: `1px solid ${C.border}` },
  inp: { background: 'var(--c-input-bg)', border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', outline: 'none' },
  lbl: { fontSize: 10, color: C.textLow, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 4 },
  btn: (bg, light) => ({ background: bg || C.purple, border: 'none', borderRadius: 8, padding: '10px 18px', color: light ? C.textMid : 'var(--c-btn-text)', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.3 }),
  secHead: (c) => ({ fontSize: 10, color: c || C.textLow, letterSpacing: 3, textTransform: 'uppercase', margin: '16px 0 8px', fontWeight: 700 }),
  sheet: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 1000, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' },
  sheetInner: { background: C.surface, borderRadius: '20px 20px 0 0', maxHeight: '92vh', display: 'flex', flexDirection: 'column' },
  sheetHeader: { padding: '18px 18px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
  pill: (on) => ({ flex: 1, padding: '9px 6px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center', border: `1px solid ${on ? C.purple : C.border}`, background: on ? C.surfaceHigh : 'transparent', color: on ? C.purple : C.textMid }),
}

const COLORS = ['#7aa2c9', '#8fb98a', '#caa46f', '#c98f8f', '#9b8fc9', '#6fc9bf', '#c9a0d6', '#c0c06f']

function fmt(n) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', currencyDisplay: 'narrowSymbol' }).format(parseFloat(n) || 0)
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false)
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const fn = e => setReduced(e.matches)
    mq.addEventListener?.('change', fn)
    return () => mq.removeEventListener?.('change', fn)
  }, [])
  return reduced
}

// A color dot that is ALWAYS paired with a label by the caller — never color alone.
function Dot({ color, hollow, size = 10 }) {
  return <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0,
    background: hollow ? 'transparent' : (color || C.textLow),
    border: hollow ? `1.5px solid ${C.textLow}` : 'none' }} />
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function Toast({ msg, onDone }) {
  useEffect(() => {
    if (!msg) return
    const id = setTimeout(onDone, 2200)
    return () => clearTimeout(id)
  }, [msg, onDone])
  if (!msg) return null
  return (
    <div role="status" style={{ position: 'fixed', left: 16, right: 16, bottom: 'calc(88px + env(safe-area-inset-bottom))', zIndex: 1200, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{ background: C.surfaceHigh, border: `1px solid ${C.green}`, color: C.text, borderRadius: 12, padding: '10px 16px', fontSize: 13, fontWeight: 600, boxShadow: '0 6px 20px rgba(0,0,0,0.4)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {msg}
      </div>
    </div>
  )
}

// ─── ENVELOPE CHIP PICKER ─────────────────────────────────────────────────────
function EnvChips({ envelopes, onPick, suggestedId }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {envelopes.map(e => (
        <button key={e.id} onClick={() => onPick(e)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: e.id === suggestedId ? C.surfaceHigh : 'transparent', border: `1px solid ${e.id === suggestedId ? C.purple : C.border}`, borderRadius: 16, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, color: C.text }}>
          {e.emoji ? <span style={{ fontSize: 12 }}>{e.emoji}</span> : <Dot color={e.color} size={8} />}
          <span>{e.name}</span>
        </button>
      ))}
    </div>
  )
}

// ─── INBOX CARD (swipe-to-assign) ─────────────────────────────────────────────
function InboxCard({ tx, suggestion, envelopes, today, reduced, onAssign, t, locale }) {
  const [dx, setDx] = useState(0)
  const [flung, setFlung] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const startX = useRef(null)
  const THRESHOLD = 110
  const canSwipe = !reduced && !!suggestion && !flung

  function down(e) {
    if (!canSwipe) return
    startX.current = e.clientX
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch {}
  }
  function move(e) {
    if (startX.current == null) return
    setDx(Math.max(0, e.clientX - startX.current))
  }
  function up() {
    if (startX.current == null) return
    const past = dx >= THRESHOLD
    startX.current = null
    if (past) commit()
    else setDx(0)
  }
  function commit() {
    setFlung(true)
    setTimeout(() => onAssign(tx, suggestion, true), reduced ? 0 : 180)
  }

  const revealOpacity = Math.min(1, dx / THRESHOLD)

  return (
    <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', marginBottom: 8 }}>
      {/* Reveal behind the card while swiping */}
      {canSwipe && (
        <div style={{ position: 'absolute', inset: 0, background: C.greenBg, display: 'flex', alignItems: 'center', paddingLeft: 16, opacity: revealOpacity }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.green, display: 'flex', alignItems: 'center', gap: 6 }}>
            → {suggestion.emoji ? suggestion.emoji + ' ' : ''}{suggestion.name}
          </span>
        </div>
      )}
      <div
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        style={{
          position: 'relative', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12,
          transform: `translateX(${flung ? 460 : dx}px)`,
          opacity: flung ? 0 : 1,
          transition: (startX.current != null) ? 'none' : (reduced ? 'none' : 'transform 0.18s ease, opacity 0.18s ease'),
          touchAction: 'pan-y',
        }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.label}</div>
            <div style={{ fontSize: 11, color: C.textLow, marginTop: 2 }}>
              {relativeDay(tx.date, today, t)}{tx.account ? ` · ${tx.account}` : ''}
            </div>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, flexShrink: 0 }}>{fmt(tx.amount)}</div>
        </div>

        {/* Suggested chip + other… */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {suggestion && (
            <button onClick={() => onAssign(tx, suggestion, true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.surfaceHigh, border: `1px solid ${C.purple}`, borderRadius: 16, padding: '5px 11px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: C.purple }}>
              {suggestion.emoji ? <span>{suggestion.emoji}</span> : <Dot color={suggestion.color} size={8} />}
              <span>{suggestion.name}</span>
            </button>
          )}
          <button onClick={() => setExpanded(v => !v)}
            style={{ background: 'none', border: `1px dashed ${C.border}`, borderRadius: 16, padding: '5px 11px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, color: C.textMid }}>
            {suggestion ? t('env.inbox.other') : t('env.inbox.assign_to')}
          </button>
          {canSwipe && (
            <span style={{ fontSize: 10, color: C.textLow, marginLeft: 'auto' }}>{t('env.inbox.swipe_hint')}</span>
          )}
        </div>
        {expanded && (
          <EnvChips envelopes={envelopes} suggestedId={suggestion?.id}
            onPick={(e) => onAssign(tx, e, false)} />
        )}
      </div>
    </div>
  )
}

// ─── INBOX SECTION ────────────────────────────────────────────────────────────
function Inbox({ items, envelopes, hints, today, reduced, onAssign, onAcceptAll, onCreateEnvelope, t, locale }) {
  const [forceOpen, setForceOpen] = useState(false)

  // New user with no envelopes → gentle CTA, never an empty void.
  if (envelopes.length === 0) {
    return (
      <div style={{ ...S.card, border: `1px dashed ${C.border}`, background: 'transparent' }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t('env.inbox.no_envelopes_title')}</div>
        <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.5, marginBottom: 10 }}>{t('env.inbox.no_envelopes_body')}</div>
        <button style={{ ...S.btn(C.purple), width: '100%' }} onClick={onCreateEnvelope}>{t('env.inbox.create_envelope')}</button>
      </div>
    )
  }

  // Cleared → calm confirmation, never an empty void.
  if (items.length === 0) {
    return (
      <div style={{ ...S.card, border: `1px solid ${C.green}`, background: C.greenBg }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginBottom: 2 }}>{t('env.inbox.empty_title')}</div>
        <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.5 }}>{t('env.inbox.empty_body')}</div>
      </div>
    )
  }

  const suggestionsFor = (tx) => {
    const id = suggestEnvelopeId(tx.label, hints)
    return id ? envelopes.find(e => e.id === id) || null : null
  }
  const anySuggestions = items.some(tx => !!suggestionsFor(tx))

  const collapsed = items.length > 15 && !forceOpen

  const Header = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>
        {t('env.inbox.title')} <span style={{ color: C.textLow, fontWeight: 400 }}>· {t('env.inbox.count', { n: items.length })}</span>
      </div>
      {anySuggestions && (
        <button onClick={onAcceptAll}
          style={{ background: C.surfaceHigh, border: `1px solid ${C.purple}`, borderRadius: 16, padding: '5px 11px', color: C.purple, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          {t('env.inbox.accept_all')}
        </button>
      )}
    </div>
  )

  if (collapsed) {
    return (
      <div style={{ border: `1px dashed ${C.purple}`, borderRadius: 14, padding: 14, marginBottom: 12, background: 'transparent' }}>
        {Header}
        <div style={{ fontSize: 12, color: C.textMid, marginBottom: 10 }}>{t('env.inbox.summary', { n: items.length })}</div>
        <button style={{ ...S.btn('transparent', true), width: '100%', border: `1px solid ${C.border}` }} onClick={() => setForceOpen(true)}>
          {t('env.inbox.open')}
        </button>
      </div>
    )
  }

  return (
    <div style={{ border: `1px dashed ${C.purple}`, borderRadius: 14, padding: 14, marginBottom: 12, background: 'transparent' }}>
      {Header}
      {items.map(tx => (
        <InboxCard key={tx.id} tx={tx} suggestion={suggestionsFor(tx)}
          envelopes={envelopes} today={today} reduced={reduced} onAssign={onAssign} t={t} locale={locale} />
      ))}
    </div>
  )
}

// ─── ENVELOPE HERO CARD ───────────────────────────────────────────────────────
function EnvelopeHero({ env, spent, reduced, onOpen, onEdit, t, locale }) {
  const available = availableFor(env)
  const remaining = available - spent
  const isOver = spent > available
  const remainPct = available > 0 ? Math.max(0, Math.min(100, (remaining / available) * 100)) : 0
  const lowFrac = available > 0 ? remaining / available : 1
  const dleft = daysLeftIn(env)

  // Animate the fill in on mount (remaining/allocated). Skip under reduced motion.
  const [w, setW] = useState(reduced ? remainPct : 0)
  useEffect(() => {
    if (reduced) { setW(remainPct); return }
    const id = requestAnimationFrame(() => setW(remainPct))
    return () => cancelAnimationFrame(id)
  }, [remainPct, reduced])

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <button onClick={onOpen} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', flex: 1 }}>
          {env.emoji ? <span style={{ fontSize: 16 }}>{env.emoji}</span> : <Dot color={env.color} />}
          <span style={{ fontSize: 14, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{env.name}</span>
        </button>
        <button onClick={onEdit} style={{ background: 'none', border: 'none', color: C.textLow, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>{t('env.edit')}</button>
      </div>

      {/* Hero number is ALWAYS amount left, never spent. */}
      <button onClick={onOpen} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', display: 'block', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>{fmt(isOver ? 0 : remaining)}</span>
          <span style={{ fontSize: 12, color: C.textLow }}>{t('env.left_big')} · {t('env.of_allocated', { amount: fmt(available) })}</span>
        </div>

        {/* Fill bar = remaining / allocated, in the envelope's own color. Never red. */}
        <div style={{ height: 8, background: C.surfaceHigh, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${w}%`, background: env.color || C.purple, borderRadius: 4,
            transition: reduced ? 'none' : 'width 0.6s ease' }} />
        </div>
      </button>

      {/* Status line — neutral, reassuring, never shaming. */}
      <div style={{ fontSize: 11, color: C.textMid, marginTop: 8, lineHeight: 1.4 }}>
        {isOver
          ? <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span>{t('env.over_by', { amount: fmt(spent - available) })}</span>
            </span>
          : lowFrac < 0.2
            ? (dleft != null ? t('env.low_reassure', { n: dleft }) : t('env.low_reassure_nopay'))
            : (dleft != null ? t('env.resets_in', { n: dleft }) : ' ')}
      </div>
    </div>
  )
}

// ─── TX EDIT / REASSIGN SHEET (universal tap-to-edit for envelope-scoped tx) ────
function TxEditSheet({ tx, envelopes, currentEnvId, bookId, onClose, onSaved }) {
  const { t } = useT()
  const [amount, setAmount] = useState(String((parseFloat(tx.amount) || 0).toFixed(2)))
  const [label, setLabel] = useState(tx.label || '')
  const [envId, setEnvId] = useState(currentEnvId || '')
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  async function save() {
    setSaving(true)
    const patch = { label: label.trim() || tx.label, amount: parseFloat(amount) || 0 }
    const newEnv = envId || null
    if (String(newEnv) !== String(currentEnvId || '')) {
      patch.envelope_id = newEnv
      patch.assigned_at = newEnv ? new Date().toISOString() : null
    }
    await supabase.from('cashflow_transactions').update(patch).eq('id', tx.id)
    if (patch.envelope_id) await upsertMerchantHint(bookId, label.trim() || tx.label, newEnv)
    setSaving(false)
    onSaved()
  }

  async function del() {
    setSaving(true)
    await supabase.from('cashflow_overrides').delete().eq('transaction_id', tx.id)
    await supabase.from('cashflow_transactions').delete().eq('id', tx.id)
    setSaving(false)
    onSaved()
  }

  return (
    <div style={S.sheet} onClick={onClose}>
      <div style={{ ...S.sheetInner, padding: '20px 18px 32px' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{tx.label}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMid, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        <div style={S.lbl}>{t('edit.description')}</div>
        <input style={{ ...S.inp, marginBottom: 12 }} value={label} onChange={e => setLabel(e.target.value)} />

        <div style={S.lbl}>{t('edit.amount')}</div>
        <input style={{ ...S.inp, marginBottom: 12, fontSize: 20, fontWeight: 700, textAlign: 'center' }} type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />

        <div style={S.lbl}>{t('env.reassign')}</div>
        <select style={{ ...S.inp, marginBottom: 16 }} value={envId} onChange={e => setEnvId(e.target.value)}>
          <option value="">{t('env.pick_none')}</option>
          {envelopes.map(e => <option key={e.id} value={e.id}>{e.emoji ? `${e.emoji} ` : ''}{e.name}</option>)}
        </select>

        <button style={{ ...S.btn(C.green), width: '100%', marginBottom: 10 }} onClick={save} disabled={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </button>

        {!confirmDel ? (
          <button onClick={() => setConfirmDel(true)} style={{ background: 'none', border: 'none', color: C.red, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', display: 'block', margin: '0 auto' }}>
            {t('edit.delete')}
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...S.btn(C.red), flex: 1 }} onClick={del} disabled={saving}>{t('edit.yes_delete')}</button>
            <button style={{ ...S.btn(C.surfaceHigh, true) }} onClick={() => setConfirmDel(false)}>{t('common.cancel')}</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── ENVELOPE DETAIL VIEW ─────────────────────────────────────────────────────
function EnvelopeDetail({ env, transactions, envelopes, bookId, today, reduced, locale, onBack, onChanged }) {
  const { t } = useT()
  const [editTx, setEditTx] = useState(null)

  const spent = computeEnvelopeSpent(env, transactions, today)
  const available = availableFor(env)
  const remaining = available - spent
  const isOver = spent > available
  const dleft = daysLeftIn(env)

  // Transactions assigned to this envelope, grouped by day (newest first).
  const groups = useMemo(() => {
    const mine = transactions
      .filter(tx => String(tx.envelope_id) === String(env.id) && tx.type === 'expense')
      .sort((a, b) => b.date.localeCompare(a.date))
    const map = new Map()
    for (const tx of mine) {
      if (!map.has(tx.date)) map.set(tx.date, [])
      map.get(tx.date).push(tx)
    }
    return Array.from(map.entries())
  }, [transactions, env.id])

  const remainPct = available > 0 ? Math.max(0, Math.min(100, (remaining / available) * 100)) : 0

  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.purple, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: '4px 0', marginBottom: 8 }}>
        {t('env.back_to_env')}
      </button>

      {/* Header card */}
      <div style={S.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          {env.emoji ? <span style={{ fontSize: 18 }}>{env.emoji}</span> : <Dot color={env.color} size={12} />}
          <span style={{ fontSize: 16, fontWeight: 700 }}>{env.name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.5 }}>{fmt(isOver ? 0 : remaining)}</span>
          <span style={{ fontSize: 13, color: C.textLow }}>{t('env.left_big')} · {t('env.of_allocated', { amount: fmt(available) })}</span>
        </div>
        <div style={{ height: 8, background: C.surfaceHigh, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
          <div style={{ height: '100%', width: `${remainPct}%`, background: env.color || C.purple, borderRadius: 4, transition: reduced ? 'none' : 'width 0.6s ease' }} />
        </div>
        <div style={{ fontSize: 11, color: C.textMid }}>
          {isOver
            ? t('env.over_by', { amount: fmt(spent - available) })
            : dleft != null ? t('env.detail_resets', { n: dleft }) : ' '}
        </div>
      </div>

      {/* Transactions grouped by day */}
      {groups.length === 0 ? (
        <div style={{ textAlign: 'center', color: C.textLow, fontSize: 13, padding: '32px 0' }}>{t('env.no_tx_yet')}</div>
      ) : groups.map(([date, txs]) => {
        const dayTotal = txs.reduce((s, tx) => s + (parseFloat(tx.amount) || 0), 0)
        return (
          <div key={date} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: C.textLow, textTransform: 'uppercase', letterSpacing: 1 }}>{relativeDay(date, today, t)}</span>
              <span style={{ fontSize: 11, color: C.textLow }}>{fmt(dayTotal)}</span>
            </div>
            {txs.map(tx => (
              <div key={tx.id} onClick={() => setEditTx(tx)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: `1px solid ${C.border}`, cursor: 'pointer' }}>
                <Dot color={env.color} size={8} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.label}</span>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{fmt(tx.amount)}</span>
              </div>
            ))}
          </div>
        )
      })}

      {editTx && (
        <TxEditSheet tx={editTx} envelopes={envelopes} currentEnvId={env.id} bookId={bookId}
          onClose={() => setEditTx(null)}
          onSaved={() => { setEditTx(null); onChanged() }} />
      )}
    </div>
  )
}

// ─── ALL ACTIVITY VIEW ────────────────────────────────────────────────────────
function AllActivity({ transactions, envelopes, bookId, today, locale, onBack, onChanged }) {
  const { t } = useT()
  const [editTx, setEditTx] = useState(null)
  const envById = useMemo(() => Object.fromEntries(envelopes.map(e => [String(e.id), e])), [envelopes])

  const groups = useMemo(() => {
    const items = transactions
      .filter(tx => tx.date && tx.date <= today)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 200)
    const map = new Map()
    for (const tx of items) {
      if (!map.has(tx.date)) map.set(tx.date, [])
      map.get(tx.date).push(tx)
    }
    return Array.from(map.entries())
  }, [transactions, today])

  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.purple, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: '4px 0', marginBottom: 8 }}>
        {t('env.back_to_env')}
      </button>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>{t('env.all_activity')}</div>
      {groups.map(([date, txs]) => (
        <div key={date} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.textLow, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{relativeDay(date, today, t)}</div>
          {txs.map(tx => {
            const env = tx.envelope_id ? envById[String(tx.envelope_id)] : null
            const isIncome = tx.type === 'income'
            return (
              <div key={tx.id} onClick={() => setEditTx(tx)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: `1px solid ${C.border}`, cursor: 'pointer' }}>
                <Dot color={env?.color} hollow={!env} size={8} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.label}</div>
                  <div style={{ fontSize: 10, color: C.textLow }}>{env ? env.name : t('env.unassigned_dot')}{tx.account ? ` · ${tx.account}` : ''}</div>
                </div>
                <span style={{ fontSize: 14, fontWeight: 700, color: isIncome ? C.green : C.text }}>{isIncome ? '+' : ''}{fmt(tx.amount)}</span>
              </div>
            )
          })}
        </div>
      ))}
      {editTx && (
        <TxEditSheet tx={editTx} envelopes={envelopes} currentEnvId={editTx.envelope_id} bookId={bookId}
          onClose={() => setEditTx(null)}
          onSaved={() => { setEditTx(null); onChanged() }} />
      )}
    </div>
  )
}

// ─── MERCHANT HINT UPSERT (shared) ────────────────────────────────────────────
export async function upsertMerchantHint(bookId, label, envelopeId) {
  const norm = normalizeMerchant(label)
  if (!norm || !envelopeId) return
  const { data: existing } = await supabase
    .from('merchant_envelope_hints')
    .select('id, assignment_count')
    .eq('book_id', bookId).eq('merchant_normalized', norm).eq('envelope_id', envelopeId)
    .limit(1)
  if (existing && existing.length) {
    await supabase.from('merchant_envelope_hints')
      .update({ assignment_count: (existing[0].assignment_count || 0) + 1, last_assigned_at: new Date().toISOString() })
      .eq('id', existing[0].id)
  } else {
    await supabase.from('merchant_envelope_hints').insert({
      book_id: bookId, merchant_normalized: norm, envelope_id: envelopeId,
      assignment_count: 1, last_assigned_at: new Date().toISOString(),
    })
  }
}

// ─── CREATE / EDIT ENVELOPE SHEET ─────────────────────────────────────────────
function EnvelopeSheet({ env, bookId, cycles, goals, onSaved, onClose }) {
  const { t } = useT()
  const editing = !!env
  const today = todayStr()
  const activeCycle = cycles.find(c => today >= c.start_date && today <= c.end_date) || cycles[0] || null

  const [name, setName] = useState(env?.name || '')
  const [amount, setAmount] = useState(env ? String(parseFloat(env.allocated_amount).toFixed(2)) : '')
  const [emoji, setEmoji] = useState(env?.emoji || '')
  const [color, setColor] = useState(env?.color || COLORS[0])
  const [linkType, setLinkType] = useState(env?.link_type || 'none')
  const [period, setPeriod] = useState(env?.period || 'biweekly')
  const [periodStart, setPeriodStart] = useState(env?.period_start || today)
  const [cycleId, setCycleId] = useState(env?.cycle_id || activeCycle?.id || '')
  const [rolloverMode, setRolloverMode] = useState(env?.rollover_mode || 'rollover')
  const [goalId, setGoalId] = useState(env?.rollover_goal_id || (goals[0]?.id || ''))
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    let pStart = null, pEnd = null, cId = null
    if (linkType === 'time') {
      pStart = periodStart
      pEnd = periodEndFor(period, periodStart)
    } else if (linkType === 'cycle') {
      const cyc = cycles.find(c => c.id === cycleId)
      cId = cyc?.id || null
      pStart = cyc?.start_date || null
      pEnd = cyc?.end_date || null
    }
    const row = {
      book_id: bookId,
      name: name.trim(),
      allocated_amount: parseFloat(amount) || 0,
      emoji: emoji || null,
      color: color || null,
      link_type: linkType,
      period: linkType === 'time' ? period : null,
      period_start: pStart,
      period_end: pEnd,
      cycle_id: cId,
      rollover_mode: rolloverMode,
      rollover_goal_id: rolloverMode === 'savings' ? (goalId || null) : null,
    }
    if (editing) {
      await supabase.from('envelopes').update(row).eq('id', env.id)
    } else {
      await supabase.from('envelopes').insert({ ...row, spent_amount: 0, carryover_amount: 0 })
    }
    setSaving(false)
    onSaved()
  }

  return (
    <div style={S.sheet}>
      <div style={S.sheetInner}>
        <div style={S.sheetHeader}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{editing ? t('env.edit_envelope') : t('env.new_envelope')}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMid, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 18px' }}>
          <div style={{ marginBottom: 14 }}>
            <div style={S.lbl}>{t('env.name')}</div>
            <input style={S.inp} placeholder={t('env.name_placeholder')} value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={S.lbl}>{t('env.amount')}</div>
              <input style={S.inp} type="number" step="0.01" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
            <div style={{ width: 90 }}>
              <div style={S.lbl}>{t('env.emoji')}</div>
              <input style={{ ...S.inp, textAlign: 'center' }} maxLength={2} placeholder="🛒" value={emoji} onChange={e => setEmoji(e.target.value)} />
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={S.lbl}>{t('env.color')}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)} style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: color === c ? `2px solid ${C.text}` : '2px solid transparent', cursor: 'pointer' }} />
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 6 }}>
            <div style={S.lbl}>{t('env.refreshes')}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={S.pill(linkType === 'none')} onClick={() => setLinkType('none')}>{t('env.link_none')}</button>
              <button style={S.pill(linkType === 'time')} onClick={() => setLinkType('time')}>{t('env.link_time')}</button>
              <button style={S.pill(linkType === 'cycle')} onClick={() => setLinkType('cycle')}>{t('env.link_cycle')}</button>
            </div>
            <div style={{ fontSize: 11, color: C.textLow, marginTop: 6, lineHeight: 1.4 }}>
              {linkType === 'none' ? t('env.link_none_hint') : linkType === 'time' ? t('env.link_time_hint') : t('env.link_cycle_hint')}
            </div>
          </div>

          {linkType === 'time' && (
            <div style={{ display: 'flex', gap: 12, margin: '12px 0' }}>
              <div style={{ flex: 1 }}>
                <div style={S.lbl}>{t('env.period')}</div>
                <select style={S.inp} value={period} onChange={e => setPeriod(e.target.value)}>
                  <option value="weekly">{t('env.period_weekly')}</option>
                  <option value="biweekly">{t('env.period_biweekly')}</option>
                  <option value="monthly">{t('env.period_monthly')}</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <div style={S.lbl}>{t('env.starts')}</div>
                <input style={S.inp} type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
              </div>
            </div>
          )}

          {linkType === 'cycle' && (
            <div style={{ margin: '12px 0' }}>
              <div style={S.lbl}>{t('env.cycle')}</div>
              {cycles.length === 0 ? (
                <div style={{ fontSize: 12, color: C.orange }}>{t('env.no_cycle_yet')}</div>
              ) : (
                <select style={S.inp} value={cycleId} onChange={e => setCycleId(e.target.value)}>
                  {cycles.map(c => (
                    <option key={c.id} value={c.id}>{c.start_date} → {c.end_date}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {linkType !== 'none' && (
            <div style={{ marginTop: 14 }}>
              <div style={S.lbl}>{t('env.leftover_title')}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={S.pill(rolloverMode === 'rollover')} onClick={() => setRolloverMode('rollover')}>{t('env.roll_over')}</button>
                <button style={S.pill(rolloverMode === 'savings')} onClick={() => setRolloverMode('savings')}>{t('env.to_savings')}</button>
                <button style={S.pill(rolloverMode === 'none')} onClick={() => setRolloverMode('none')}>{t('env.reset')}</button>
              </div>
              {rolloverMode === 'savings' && (
                <div style={{ marginTop: 10 }}>
                  {goals.length === 0 ? (
                    <div style={{ fontSize: 12, color: C.orange }}>{t('env.no_goal_yet')}</div>
                  ) : (
                    <select style={S.inp} value={goalId} onChange={e => setGoalId(e.target.value)}>
                      {goals.map(g => <option key={g.id} value={g.id}>{g.emoji ? `${g.emoji} ` : ''}{g.name}</option>)}
                    </select>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div style={{ padding: '12px 18px 28px', borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
          <button style={{ ...S.btn(C.green), width: '100%', opacity: saving || !name.trim() ? 0.6 : 1 }} disabled={saving || !name.trim()} onClick={save}>
            {saving ? t('common.saving') : editing ? t('common.save') : t('env.create')}
          </button>
          {editing && (
            <button style={{ ...S.btn('transparent', true), width: '100%', marginTop: 8, color: C.red }} onClick={() => onSaved('delete')}>
              {t('env.delete')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── MAIN ENVELOPES TAB ───────────────────────────────────────────────────────
export default function EnvelopesTab({ bookId, transactions = [], onRefresh, onGoToCycles, openInbox }) {
  const { t, locale } = useT()
  const reduced = useReducedMotion()
  const today = todayStr()
  const [envelopes, setEnvelopes] = useState([])
  const [history, setHistory] = useState([])
  const [cycles, setCycles] = useState([])
  const [goals, setGoals] = useState([])
  const [hints, setHints] = useState([])
  const [loading, setLoading] = useState(true)
  const [sheet, setSheet] = useState(null)        // null | 'new' | envelope object
  const [view, setView] = useState('list')        // 'list' | 'all' | { detail: env }
  const [showOverflow, setShowOverflow] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [dismissedSugg, setDismissedSugg] = useState([])
  const [toast, setToast] = useState(null)

  useEffect(() => { load() }, [bookId])

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      const [{ data: envs }, { data: hist }, { data: cyc }, { data: gls }, { data: hnt }] = await Promise.all([
        supabase.from('envelopes').select('*').eq('book_id', bookId).eq('archived', false).order('display_order'),
        supabase.from('envelope_period_history').select('*').eq('book_id', bookId).order('closed_at'),
        supabase.from('pay_cycles').select('*').eq('book_id', bookId).order('start_date', { ascending: false }).limit(12),
        supabase.from('savings_goals').select('*').eq('book_id', bookId).order('created_at'),
        supabase.from('merchant_envelope_hints').select('*').eq('book_id', bookId),
      ])
      setEnvelopes(envs || [])
      setHistory(hist || [])
      setCycles(cyc || [])
      setGoals(gls || [])
      setHints(hnt || [])
    } catch (e) {
      console.error('EnvelopesTab load error:', e)
    } finally {
      setLoading(false)
    }
  }

  function refreshAll() { load(true); onRefresh?.() }

  // Spent per envelope, derived from assigned transactions.
  const spentByEnv = useMemo(() => {
    const m = {}
    for (const env of envelopes) m[env.id] = computeEnvelopeSpent(env, transactions, today)
    return m
  }, [envelopes, transactions, today])

  // Inbox items (unassigned recent spending).
  const inbox = useMemo(() => inboxTransactions(transactions, today), [transactions, today])

  // Assign one transaction to an envelope (manual pick or accepted suggestion).
  async function assign(tx, env, viaSuggestion) {
    await supabase.from('cashflow_transactions')
      .update({ envelope_id: env.id, assigned_at: new Date().toISOString() }).eq('id', tx.id)
    await upsertMerchantHint(bookId, tx.label, env.id)
    setToast(t('env.inbox.assigned_toast', { merchant: tx.label, envelope: env.name }))
    refreshAll()
  }

  async function acceptAll() {
    let n = 0
    for (const tx of inbox) {
      const id = suggestEnvelopeId(tx.label, hints)
      if (!id) continue
      const env = envelopes.find(e => e.id === id)
      if (!env) continue
      await supabase.from('cashflow_transactions')
        .update({ envelope_id: env.id, assigned_at: new Date().toISOString() }).eq('id', tx.id)
      await upsertMerchantHint(bookId, tx.label, env.id)
      n++
    }
    if (n > 0) setToast(t('env.inbox.count', { n }))
    refreshAll()
  }

  // Close out one ended period: write history, apply rollover / move-to-savings.
  async function closeOut(env, nextWin) {
    const spent = spentByEnv[env.id] ?? 0
    const { patch, history: histRow, toSavings } = computeCloseOut(env, { ...(nextWin || {}), spent })
    await supabase.from('envelope_period_history').insert(histRow)
    if (toSavings > 0) {
      await supabase.from('savings_contributions').insert({
        goal_id: env.rollover_goal_id, amount: toSavings, date: todayStr(),
        note: t('env.from_envelope', { name: env.name }),
      })
      const goal = goals.find(g => g.id === env.rollover_goal_id)
      if (goal) {
        const newAmt = (parseFloat(goal.current_amount) || 0) + toSavings
        await supabase.from('savings_goals').update({ current_amount: newAmt }).eq('id', goal.id)
      }
    }
    await supabase.from('envelopes').update(patch).eq('id', env.id)
  }

  const endedEnvelopes = useMemo(() => envelopes.filter(e => isPeriodOver(e)), [envelopes])

  async function closeOutAll() {
    const td = todayStr()
    for (const env of endedEnvelopes) {
      let nextWin = null
      if (env.link_type === 'cycle') {
        const cyc = cycles.find(c => td >= c.start_date && td <= c.end_date)
        nextWin = cyc ? { nextStart: cyc.start_date, nextEnd: cyc.end_date } : { nextStart: null, nextEnd: null }
      }
      await closeOut(env, nextWin)
    }
    refreshAll()
  }

  async function deleteEnvelope(env) {
    await supabase.from('envelopes').delete().eq('id', env.id)
    setSheet(null)
    refreshAll()
  }

  const suggestions = useMemo(() => {
    const all = [
      ...buildEnvelopeSuggestions(envelopes, history),
      ...buildCycleSuggestions(envelopes, cycles),
    ]
    return all.filter(s => !dismissedSugg.includes(s.id))
  }, [envelopes, history, cycles, dismissedSugg])

  async function applySuggestion(s) {
    if (s.kind === 'lower' || s.kind === 'raise') {
      await supabase.from('envelopes').update({ allocated_amount: s.suggestedAmount }).eq('id', s.envelopeId)
      refreshAll()
    } else if (s.kind === 'cycle_started') {
      const cyc = s.cycle
      const ids = envelopes.filter(e => e.link_type !== 'cycle' || e.cycle_id !== cyc.id).map(e => e.id)
      await supabase.from('envelopes').update({
        link_type: 'cycle', cycle_id: cyc.id, period_start: cyc.start_date, period_end: cyc.end_date,
      }).in('id', ids)
      setDismissedSugg(prev => [...prev, s.id])
      refreshAll()
    } else if (s.kind === 'create_cycle') {
      onGoToCycles?.()
    }
  }

  // Days until the current pay cycle resets (for the header).
  const cycleDaysLeft = useMemo(() => {
    const c = cycles.find(c => today >= c.start_date && today <= c.end_date)
    if (!c) return null
    const end = new Date(c.end_date + 'T00:00:00')
    const now = new Date(today + 'T00:00:00')
    return Math.max(0, Math.round((end - now) / 86400000) + 1)
  }, [cycles, today])

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
      <div style={{ width: 24, height: 24, border: `2px solid ${C.border}`, borderTop: `2px solid ${C.purple}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    </div>
  )

  // Detail / all-activity sub-views
  if (view === 'all') {
    return <>
      <AllActivity transactions={transactions} envelopes={envelopes} bookId={bookId} today={today} locale={locale}
        onBack={() => setView('list')} onChanged={refreshAll} />
      <Toast msg={toast} onDone={() => setToast(null)} />
    </>
  }
  if (view && view.detail) {
    const env = envelopes.find(e => e.id === view.detail.id) || view.detail
    return <>
      <EnvelopeDetail env={env} transactions={transactions} envelopes={envelopes} bookId={bookId}
        today={today} reduced={reduced} locale={locale}
        onBack={() => setView('list')} onChanged={refreshAll} />
      <Toast msg={toast} onDone={() => setToast(null)} />
      {sheet && (
        <EnvelopeSheet env={sheet === 'new' ? null : sheet} bookId={bookId} cycles={cycles} goals={goals}
          onSaved={(act) => { if (act === 'delete' && sheet !== 'new') { deleteEnvelope(sheet); return } setSheet(null); refreshAll() }}
          onClose={() => setSheet(null)} />
      )}
    </>
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{t('env.title')}</div>
          <div style={{ fontSize: 11, color: C.textLow, marginTop: 2 }}>
            {cycleDaysLeft == null ? t('env.no_cycle')
              : cycleDaysLeft === 0 ? t('env.next_pay_today')
              : t('env.next_pay_in', { n: cycleDaysLeft })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, position: 'relative' }}>
          <button onClick={() => setShowHelp(v => !v)} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 16, width: 26, height: 26, color: C.textMid, cursor: 'pointer', fontFamily: 'inherit' }}>ⓘ</button>
          <button onClick={() => setShowOverflow(v => !v)} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 16, width: 26, height: 26, color: C.textMid, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, lineHeight: 1 }}>⋯</button>
          {showOverflow && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowOverflow(false)} />
              <div style={{ position: 'absolute', top: 32, right: 0, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, zIndex: 41, minWidth: 180, overflow: 'hidden' }}>
                <button onClick={() => { setShowOverflow(false); setView('all') }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '11px 14px', color: C.text, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer' }}>{t('env.overflow_all')}</button>
                <button onClick={() => { setShowOverflow(false); setSheet('new') }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderTop: `1px solid ${C.border}`, padding: '11px 14px', color: C.text, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer' }}>{t('env.overflow_manage')}</button>
              </div>
            </>
          )}
        </div>
      </div>

      {showHelp && (
        <div style={{ ...S.card, background: C.surfaceHigh }}>
          <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.55 }}>{t('env.explain')}</div>
        </div>
      )}

      {/* Needs-a-home inbox */}
      <Inbox items={inbox} envelopes={envelopes} hints={hints} today={today} reduced={reduced}
        onAssign={assign} onAcceptAll={acceptAll} onCreateEnvelope={() => setSheet('new')} t={t} locale={locale} />

      {/* Ended periods → close-out prompt */}
      {endedEnvelopes.length > 0 && (
        <div style={{ ...S.card, background: C.greenBg, border: `1px solid ${C.green}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.green, marginBottom: 4 }}>{t('env.period_ended_title')}</div>
          <div style={{ fontSize: 12, color: C.textMid, marginBottom: 10, lineHeight: 1.5 }}>{t('env.period_ended_body', { n: endedEnvelopes.length })}</div>
          {endedEnvelopes.map(env => {
            const left = availableFor(env) - (spentByEnv[env.id] ?? 0)
            const fate = env.rollover_mode === 'rollover' ? t('env.fate_rollover', { amount: fmt(Math.max(0, left)) })
              : env.rollover_mode === 'savings' ? t('env.fate_savings', { amount: fmt(Math.max(0, left)) })
              : t('env.fate_reset')
            return (
              <div key={env.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0' }}>
                <span style={{ color: C.textMid }}>{env.emoji ? `${env.emoji} ` : ''}{env.name}</span>
                <span style={{ color: C.textMid }}>{fate}</span>
              </div>
            )
          })}
          <button style={{ ...S.btn(C.green), width: '100%', marginTop: 10 }} onClick={closeOutAll}>{t('env.close_out')}</button>
        </div>
      )}

      {/* Insights */}
      {suggestions.length > 0 && (
        <>
          <div style={S.secHead(C.blue)}>{t('env.insights')}</div>
          {suggestions.map(s => {
            const env = envelopes.find(e => e.id === s.envelopeId)
            let title = '', body = '', actionLabel = ''
            if (s.kind === 'lower') {
              title = t('env.sugg_lower_title', { name: env?.name || '' })
              body = t('env.sugg_lower_body', { avg: fmt(s.avgSpend), n: s.periods, amount: fmt(s.suggestedAmount) })
              actionLabel = t('env.sugg_apply')
            } else if (s.kind === 'raise') {
              title = t('env.sugg_raise_title', { name: env?.name || '' })
              body = t('env.sugg_raise_body', { avg: fmt(s.avgSpend), n: s.periods, amount: fmt(s.suggestedAmount) })
              actionLabel = t('env.sugg_apply')
            } else if (s.kind === 'cycle_started') {
              title = t('env.sugg_cycle_started_title')
              body = t('env.sugg_cycle_started_body')
              actionLabel = t('env.sugg_link_all')
            } else if (s.kind === 'create_cycle') {
              title = t('env.sugg_create_cycle_title')
              body = t('env.sugg_create_cycle_body')
              actionLabel = t('env.sugg_go_cycles')
            }
            return (
              <div key={s.id} style={{ ...S.card, borderLeft: `3px solid ${C.blue}` }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>{title}</div>
                <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.5, marginBottom: 10 }}>{body}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={{ ...S.btn(C.blue), flex: 1 }} onClick={() => applySuggestion(s)}>{actionLabel}</button>
                  <button style={{ ...S.btn(C.surfaceHigh, true), flex: 0 }} onClick={() => setDismissedSugg(prev => [...prev, s.id])}>{t('env.dismiss')}</button>
                </div>
              </div>
            )
          })}
        </>
      )}

      {/* Envelope hero cards */}
      {envelopes.length > 0 && <div style={S.secHead(C.purple)}>{t('env.your_envelopes')}</div>}
      {envelopes.map(env => (
        <EnvelopeHero key={env.id} env={env} spent={spentByEnv[env.id] ?? 0} reduced={reduced}
          onOpen={() => setView({ detail: env })} onEdit={() => setSheet(env)} t={t} locale={locale} />
      ))}

      {envelopes.length > 0 && (
        <button onClick={() => setSheet('new')}
          style={{ width: '100%', background: 'none', border: `1px dashed ${C.border}`, borderRadius: 10, color: C.purple, fontSize: 13, fontWeight: 700, padding: '13px 0', cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 }}>
          {t('env.add_envelope')}
        </button>
      )}

      {sheet && (
        <EnvelopeSheet
          env={sheet === 'new' ? null : sheet}
          bookId={bookId} cycles={cycles} goals={goals}
          onSaved={(act) => {
            if (act === 'delete' && sheet !== 'new') { deleteEnvelope(sheet); return }
            setSheet(null); refreshAll()
          }}
          onClose={() => setSheet(null)}
        />
      )}

      <Toast msg={toast} onDone={() => setToast(null)} />
    </div>
  )
}
