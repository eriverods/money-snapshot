import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'

const C = {
  bg: '#0a0f1a', surface: '#111827', surfaceHigh: '#1e293b',
  border: '#1e293b', text: '#f1f5f9', textMid: '#94a3b8', textLow: '#475569',
  green: '#4ade80', greenBg: '#064e3b', red: '#f87171', redBg: '#450a0a',
  orange: '#f97316', purple: '#a78bfa', blue: '#38bdf8',
}
const S = {
  card: { background: C.surface, borderRadius: 14, padding: 14, marginBottom: 12, border: `1px solid ${C.border}` },
  inp: { background: '#0f172a', border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', outline: 'none' },
  lbl: { fontSize: 10, color: C.textLow, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 4 },
  btn: (bg, light) => ({ background: bg || C.purple, border: 'none', borderRadius: 8, padding: '10px 18px', color: light ? C.textMid : '#0a0f1a', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.3 }),
  secHead: (c) => ({ fontSize: 10, color: c || C.textLow, letterSpacing: 3, textTransform: 'uppercase', margin: '16px 0 8px', fontWeight: 700 }),
  sheet: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 1000, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' },
  sheetInner: { background: C.surface, borderRadius: '20px 20px 0 0', maxHeight: '92vh', display: 'flex', flexDirection: 'column' },
  sheetHeader: { padding: '18px 18px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
  sheetBody: { padding: '16px 18px', overflowY: 'auto' },
}

function fmt(n) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(parseFloat(n) || 0)
}

function todayStr() { return new Date().toISOString().slice(0, 10) }

const EMOJIS = ['🎯', '🏖️', '🚗', '🏠', '💍', '🎓', '🌍', '🛡️', '💻', '🎸', '👶', '🐕', '⛵', '🏋️', '✈️', '🏥']
const COLORS = [C.purple, C.green, C.blue, C.orange, '#f472b6', '#34d399', '#60a5fa', '#fbbf24']

// ─── GOAL CARD ────────────────────────────────────────────────────────────────
function GoalCard({ goal, onAddFunds, onDelete }) {
  const current = parseFloat(goal.current_amount) || 0
  const target = parseFloat(goal.target_amount) || 0
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0
  const remaining = Math.max(0, target - current)
  const done = current >= target
  const barColor = goal.color || C.purple

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 26 }}>{goal.emoji || '🎯'}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{goal.name}</div>
            <div style={{ fontSize: 11, color: C.textLow, marginTop: 1 }}>
              {done ? 'Goal reached!' : `${fmt(remaining)} to go`}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: done ? C.green : C.text }}>{fmt(current)}</div>
          <div style={{ fontSize: 10, color: C.textLow }}>of {fmt(target)}</div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ background: C.surfaceHigh, borderRadius: 6, height: 8, marginBottom: 12, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: done ? C.green : barColor, borderRadius: 6, transition: 'width 0.3s' }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: barColor, fontWeight: 700 }}>{pct.toFixed(0)}%</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onDelete(goal)} style={{ ...S.btn(C.surfaceHigh, true), padding: '7px 12px', fontSize: 12 }}>
            Delete
          </button>
          {!done && (
            <button onClick={() => onAddFunds(goal)} style={{ ...S.btn(barColor), padding: '7px 14px', fontSize: 12 }}>
              + Add Funds
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── ADD FUNDS SHEET ──────────────────────────────────────────────────────────
function AddFundsSheet({ goal, onClose, onSaved }) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(todayStr())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  async function handleSave() {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { setErr('Enter a valid amount'); return }
    setSaving(true)
    setErr(null)
    const { error: contribErr } = await supabase.from('savings_contributions').insert({
      goal_id: goal.id, amount: amt, note: note.trim() || null, date,
    })
    if (contribErr) { setErr(contribErr.message); setSaving(false); return }
    const newAmount = (parseFloat(goal.current_amount) || 0) + amt
    const { error: goalErr } = await supabase.from('savings_goals').update({ current_amount: newAmount }).eq('id', goal.id)
    if (goalErr) { setErr(goalErr.message); setSaving(false); return }
    setSaving(false)
    onSaved()
  }

  return (
    <div style={S.sheet} onClick={onClose}>
      <div style={S.sheetInner} onClick={e => e.stopPropagation()}>
        <div style={S.sheetHeader}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{goal.emoji} Add Funds</div>
            <div style={{ fontSize: 11, color: C.textLow, marginTop: 2 }}>{goal.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textLow, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={S.sheetBody}>
          <div style={{ marginBottom: 14 }}>
            <div style={S.lbl}>Amount (CAD)</div>
            <input
              style={S.inp} type="number" inputMode="decimal" placeholder="0.00"
              value={amount} onChange={e => setAmount(e.target.value)} autoFocus
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={S.lbl}>Date</div>
            <input style={S.inp} type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <div style={S.lbl}>Note (optional)</div>
            <input style={S.inp} placeholder="e.g. Bonus, tax return…" value={note} onChange={e => setNote(e.target.value)} />
          </div>
          {err && <div style={{ color: C.red, fontSize: 12, marginBottom: 12 }}>{err}</div>}
          <button onClick={handleSave} disabled={saving} style={{ ...S.btn(), width: '100%', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save Contribution'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── NEW GOAL SHEET ───────────────────────────────────────────────────────────
function NewGoalSheet({ bookId, onClose, onSaved }) {
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [current, setCurrent] = useState('')
  const [emoji, setEmoji] = useState('🎯')
  const [color, setColor] = useState(C.purple)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  async function handleSave() {
    if (!name.trim()) { setErr('Enter a goal name'); return }
    const t = parseFloat(target)
    if (!t || t <= 0) { setErr('Enter a target amount'); return }
    const c = parseFloat(current) || 0
    setSaving(true)
    setErr(null)
    const { error } = await supabase.from('savings_goals').insert({
      book_id: bookId, name: name.trim(), target_amount: t, current_amount: c, emoji, color,
    })
    if (error) { setErr(error.message); setSaving(false); return }
    setSaving(false)
    onSaved()
  }

  return (
    <div style={S.sheet} onClick={onClose}>
      <div style={S.sheetInner} onClick={e => e.stopPropagation()}>
        <div style={S.sheetHeader}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>New Savings Goal</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textLow, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={S.sheetBody}>
          <div style={{ marginBottom: 14 }}>
            <div style={S.lbl}>Goal Name</div>
            <input style={S.inp} placeholder="e.g. Emergency Fund" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={S.lbl}>Target Amount (CAD)</div>
            <input style={S.inp} type="number" inputMode="decimal" placeholder="0.00" value={target} onChange={e => setTarget(e.target.value)} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={S.lbl}>Starting Balance (optional)</div>
            <input style={S.inp} type="number" inputMode="decimal" placeholder="0.00" value={current} onChange={e => setCurrent(e.target.value)} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={S.lbl}>Emoji</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {EMOJIS.map(e => (
                <button key={e} onClick={() => setEmoji(e)}
                  style={{ fontSize: 22, background: emoji === e ? C.surfaceHigh : 'none', border: `1px solid ${emoji === e ? C.purple : 'transparent'}`, borderRadius: 8, padding: '4px 6px', cursor: 'pointer' }}>
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={S.lbl}>Color</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {COLORS.map(col => (
                <button key={col} onClick={() => setColor(col)}
                  style={{ width: 28, height: 28, borderRadius: '50%', background: col, border: `2px solid ${color === col ? C.text : 'transparent'}`, cursor: 'pointer' }} />
              ))}
            </div>
          </div>

          {err && <div style={{ color: C.red, fontSize: 12, marginBottom: 12 }}>{err}</div>}
          <button onClick={handleSave} disabled={saving} style={{ ...S.btn(color), width: '100%', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Create Goal'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── GOALS TAB ────────────────────────────────────────────────────────────────
export default function GoalsTab({ bookId }) {
  const [goals, setGoals] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [addFundsGoal, setAddFundsGoal] = useState(null)

  async function loadGoals() {
    const { data } = await supabase.from('savings_goals').select('*').eq('book_id', bookId).order('created_at')
    setGoals(data || [])
    setLoading(false)
  }

  useEffect(() => { loadGoals() }, [bookId])

  async function handleDelete(goal) {
    if (!window.confirm(`Delete "${goal.name}"? This cannot be undone.`)) return
    await supabase.from('savings_goals').delete().eq('id', goal.id)
    setGoals(prev => prev.filter(g => g.id !== goal.id))
  }

  const totalSaved = goals.reduce((s, g) => s + (parseFloat(g.current_amount) || 0), 0)
  const totalTarget = goals.reduce((s, g) => s + (parseFloat(g.target_amount) || 0), 0)

  if (loading) return <div style={{ color: C.textLow, textAlign: 'center', padding: 32, fontSize: 13 }}>Loading…</div>

  return (
    <div>
      {/* Summary */}
      {goals.length > 0 && (
        <div style={{ ...S.card, background: 'linear-gradient(135deg,#1e1b4b,#0f172a)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 10, color: C.textLow, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 }}>Total Saved</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: C.green }}>{fmt(totalSaved)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: C.textLow, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 }}>Total Target</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: C.text }}>{fmt(totalTarget)}</div>
            </div>
          </div>
          {totalTarget > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ background: C.surfaceHigh, borderRadius: 6, height: 6, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, (totalSaved / totalTarget) * 100)}%`, height: '100%', background: C.green, borderRadius: 6, transition: 'width 0.3s' }} />
              </div>
              <div style={{ fontSize: 10, color: C.textLow, marginTop: 4, textAlign: 'right' }}>
                {((totalSaved / totalTarget) * 100).toFixed(0)}% of all goals
              </div>
            </div>
          )}
        </div>
      )}

      {/* Goal cards */}
      {goals.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🎯</div>
          <div style={{ color: C.textMid, fontSize: 14, marginBottom: 6 }}>No savings goals yet</div>
          <div style={{ color: C.textLow, fontSize: 12, marginBottom: 24 }}>Create your first goal to start tracking your progress</div>
          <button onClick={() => setShowNew(true)} style={{ ...S.btn(), padding: '11px 24px' }}>
            Create First Goal
          </button>
        </div>
      ) : (
        <>
          <div style={S.secHead()}>Goals ({goals.length})</div>
          {goals.map(g => (
            <GoalCard key={g.id} goal={g} onAddFunds={setAddFundsGoal} onDelete={handleDelete} />
          ))}
          <button onClick={() => setShowNew(true)} style={{ ...S.btn(), width: '100%', marginTop: 4, marginBottom: 16 }}>
            + New Goal
          </button>
        </>
      )}

      {showNew && (
        <NewGoalSheet bookId={bookId} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); loadGoals() }} />
      )}
      {addFundsGoal && (
        <AddFundsSheet goal={addFundsGoal} onClose={() => setAddFundsGoal(null)} onSaved={() => { setAddFundsGoal(null); loadGoals() }} />
      )}
    </div>
  )
}
