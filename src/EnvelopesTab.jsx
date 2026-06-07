import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase'
import { useT } from './i18n'
import {
  todayStr, periodEndFor, isPeriodOver, daysLeftIn, availableFor, leftoverFor,
  computeCloseOut, buildEnvelopeSuggestions, buildCycleSuggestions,
} from './lib/envelopeLogic'

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

// ─── ENVELOPE CARD ────────────────────────────────────────────────────────────
function EnvelopeCard({ env, onUpdateSpent, onEdit }) {
  const { t } = useT()
  const available = availableFor(env)
  const spent = parseFloat(env.spent_amount) || 0
  const remaining = available - spent
  const pct = available > 0 ? Math.min(100, (spent / available) * 100) : 0
  const isOver = spent > available
  const barColor = isOver ? C.red : pct > 80 ? C.orange : C.green
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(String(spent.toFixed(2)))
  const carry = parseFloat(env.carryover_amount) || 0
  const dleft = daysLeftIn(env)

  function save() { onUpdateSpent(env.id, parseFloat(val) || 0); setEditing(false) }

  const linkLabel = env.link_type === 'cycle' ? t('env.linked_cycle')
    : env.link_type === 'time' ? t(`env.period_${env.period || 'biweekly'}`)
    : t('env.always_on')

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {env.emoji
            ? <span style={{ fontSize: 16 }}>{env.emoji}</span>
            : env.color && <div style={{ width: 10, height: 10, borderRadius: '50%', background: env.color, flexShrink: 0 }} />}
          <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{env.name}</span>
        </div>
        <button onClick={() => onEdit(env)} style={{ background: 'none', border: 'none', color: C.textLow, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>{t('env.edit')}</button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: C.textLow }}>
          {linkLabel}{dleft != null ? ` · ${t('env.days_left', { n: dleft })}` : ''}
        </span>
        <span style={{ fontSize: 12, color: isOver ? C.red : remaining < 20 ? C.orange : C.textMid }}>
          {t('env.left', { amount: fmt(remaining) })}
        </span>
      </div>

      <div style={{ height: 6, background: C.surfaceHigh, borderRadius: 3, marginBottom: 8, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: C.textLow }}>
          {t('env.spent_of', { spent: fmt(spent), allocated: fmt(available) })}
          {carry > 0 ? ` · ${t('env.incl_rollover', { amount: fmt(carry) })}` : ''}
        </span>
        {editing ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input style={{ ...S.inp, width: 90, padding: '5px 8px', fontSize: 13 }} type="number" step="0.01" value={val}
              onChange={e => setVal(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }} />
            <button style={S.btn(C.green)} onClick={save}>✓</button>
            <button style={S.btn(C.surfaceHigh, true)} onClick={() => setEditing(false)}>✕</button>
          </div>
        ) : (
          <button onClick={() => { setVal(String(spent.toFixed(2))); setEditing(true) }}
            style={{ fontSize: 11, color: C.purple, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            {t('env.update_spent')}
          </button>
        )}
      </div>
    </div>
  )
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

          {/* Link type */}
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

          {/* Rollover behaviour — only meaningful for periodic envelopes */}
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
export default function EnvelopesTab({ bookId, onGoToCycles }) {
  const { t, locale } = useT()
  const [envelopes, setEnvelopes] = useState([])
  const [history, setHistory] = useState([])
  const [cycles, setCycles] = useState([])
  const [goals, setGoals] = useState([])
  const [loading, setLoading] = useState(true)
  const [sheet, setSheet] = useState(null) // null | 'new' | envelope object
  const [showHelp, setShowHelp] = useState(false)
  const [dismissedSugg, setDismissedSugg] = useState([])

  useEffect(() => { load() }, [bookId])

  async function load() {
    setLoading(true)
    try {
      const [{ data: envs }, { data: hist }, { data: cyc }, { data: gls }] = await Promise.all([
        supabase.from('envelopes').select('*').eq('book_id', bookId).eq('archived', false).order('display_order'),
        supabase.from('envelope_period_history').select('*').eq('book_id', bookId).order('closed_at'),
        supabase.from('pay_cycles').select('*').eq('book_id', bookId).order('start_date', { ascending: false }).limit(12),
        supabase.from('savings_goals').select('*').eq('book_id', bookId).order('created_at'),
      ])
      setEnvelopes(envs || [])
      setHistory(hist || [])
      setCycles(cyc || [])
      setGoals(gls || [])
    } catch (e) {
      console.error('EnvelopesTab load error:', e)
    } finally {
      setLoading(false)
    }
  }

  async function updateSpent(envId, newSpent) {
    await supabase.from('envelopes').update({ spent_amount: newSpent }).eq('id', envId)
    setEnvelopes(prev => prev.map(e => e.id === envId ? { ...e, spent_amount: newSpent } : e))
  }

  // Close out one ended period: write history, apply rollover / move-to-savings, open next window.
  async function closeOut(env, nextWin) {
    const { patch, history: histRow, toSavings } = computeCloseOut(env, nextWin || {})
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

  // Envelopes whose period has ended and need rolling forward.
  const endedEnvelopes = useMemo(() => envelopes.filter(e => isPeriodOver(e)), [envelopes])

  async function closeOutAll() {
    const today = todayStr()
    for (const env of endedEnvelopes) {
      let nextWin = null
      if (env.link_type === 'cycle') {
        // Adopt the cycle that now covers today, if any; else just blank the window.
        const cyc = cycles.find(c => today >= c.start_date && today <= c.end_date)
        nextWin = cyc
          ? { nextStart: cyc.start_date, nextEnd: cyc.end_date }
          : { nextStart: null, nextEnd: null }
      }
      await closeOut(env, nextWin)
    }
    await load()
  }

  async function deleteEnvelope(env) {
    await supabase.from('envelopes').delete().eq('id', env.id)
    setSheet(null)
    load()
  }

  // Suggestions (behaviour learning + cycle nudges)
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
      load()
    } else if (s.kind === 'cycle_started') {
      const cyc = s.cycle
      const ids = envelopes.filter(e => e.link_type !== 'cycle' || e.cycle_id !== cyc.id).map(e => e.id)
      await supabase.from('envelopes').update({
        link_type: 'cycle', cycle_id: cyc.id, period_start: cyc.start_date, period_end: cyc.end_date,
      }).in('id', ids)
      setDismissedSugg(prev => [...prev, s.id])
      load()
    } else if (s.kind === 'create_cycle') {
      onGoToCycles?.()
    }
  }

  const totals = useMemo(() => {
    const allocated = envelopes.reduce((s, e) => s + availableFor(e), 0)
    const spent = envelopes.reduce((s, e) => s + (parseFloat(e.spent_amount) || 0), 0)
    return { allocated, spent, left: allocated - spent }
  }, [envelopes])

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
      <div style={{ width: 24, height: 24, border: `2px solid ${C.border}`, borderTop: `2px solid ${C.purple}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    </div>
  )

  return (
    <div style={{ padding: '16px 16px 0' }}>
      {/* Title + help */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{t('env.title')}</div>
        <button onClick={() => setShowHelp(v => !v)} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 16, width: 26, height: 26, color: C.textMid, cursor: 'pointer', fontFamily: 'inherit' }}>ⓘ</button>
      </div>

      {(showHelp || envelopes.length === 0) && (
        <div style={{ ...S.card, background: C.surfaceHigh }}>
          <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.55 }}>{t('env.explain')}</div>
          <div style={{ marginTop: 10, fontSize: 12, color: C.textLow, lineHeight: 1.6 }}>
            <div>• {t('env.explain_none')}</div>
            <div>• {t('env.explain_time')}</div>
            <div>• {t('env.explain_cycle')}</div>
            <div style={{ marginTop: 6 }}>• {t('env.explain_rollover')}</div>
          </div>
        </div>
      )}

      {/* Ended periods → close-out prompt */}
      {endedEnvelopes.length > 0 && (
        <div style={{ ...S.card, background: C.greenBg, border: `1px solid ${C.green}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.green, marginBottom: 4 }}>{t('env.period_ended_title')}</div>
          <div style={{ fontSize: 12, color: C.textMid, marginBottom: 10, lineHeight: 1.5 }}>
            {t('env.period_ended_body', { n: endedEnvelopes.length })}
          </div>
          {endedEnvelopes.map(env => {
            const left = leftoverFor(env)
            const fate = env.rollover_mode === 'rollover' ? t('env.fate_rollover', { amount: fmt(Math.max(0, left)) })
              : env.rollover_mode === 'savings' ? t('env.fate_savings', { amount: fmt(Math.max(0, left)) })
              : t('env.fate_reset')
            return (
              <div key={env.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0' }}>
                <span style={{ color: C.textMid }}>{env.emoji ? `${env.emoji} ` : ''}{env.name}</span>
                <span style={{ color: left >= 0 ? C.green : C.red }}>{fate}</span>
              </div>
            )
          })}
          <button style={{ ...S.btn(C.green), width: '100%', marginTop: 10 }} onClick={closeOutAll}>{t('env.close_out')}</button>
        </div>
      )}

      {/* Summary */}
      {envelopes.length > 0 && (
        <div style={{ ...S.card, display: 'flex', gap: 8 }}>
          {[
            { lbl: t('env.budgeted'), val: fmt(totals.allocated), color: C.text },
            { lbl: t('env.spent'), val: fmt(totals.spent), color: C.red },
            { lbl: t('env.left_total'), val: fmt(totals.left), color: totals.left < 0 ? C.red : C.green },
          ].map((b, i) => (
            <div key={i} style={{ flex: 1, background: C.surfaceHigh, borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: C.textLow, textTransform: 'uppercase', letterSpacing: 1 }}>{b.lbl}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: b.color }}>{b.val}</div>
            </div>
          ))}
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

      {/* Envelope list */}
      {envelopes.length > 0 && <div style={S.secHead(C.purple)}>{t('env.your_envelopes')}</div>}
      {envelopes.map(env => (
        <EnvelopeCard key={env.id} env={env} onUpdateSpent={updateSpent} onEdit={(e) => setSheet(e)} />
      ))}

      <button onClick={() => setSheet('new')}
        style={{ width: '100%', background: 'none', border: `1px dashed ${C.border}`, borderRadius: 10, color: C.purple, fontSize: 13, fontWeight: 700, padding: '13px 0', cursor: 'pointer', fontFamily: 'inherit', marginTop: 4, marginBottom: 24 }}>
        {t('env.add_envelope')}
      </button>

      {sheet && (
        <EnvelopeSheet
          env={sheet === 'new' ? null : sheet}
          bookId={bookId} cycles={cycles} goals={goals}
          onSaved={(act) => {
            if (act === 'delete' && sheet !== 'new') { deleteEnvelope(sheet); return }
            setSheet(null); load()
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}
