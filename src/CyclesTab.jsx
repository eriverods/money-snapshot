import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase'
import {
  findApprovedMainIncome,
  createCycleFromApprovedPaycheck,
  calculateCycleWindow,
  identifyFixedBillsInWindow,
  suggestEnvelopeAllocations,
} from './lib/cycleLogic'

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
}

function fmt(n) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(parseFloat(n) || 0)
}

function todayStr() { return new Date().toISOString().slice(0, 10) }

function nextFriday(fromDate) {
  const d = new Date(fromDate + 'T00:00:00')
  const daysUntil = (5 - d.getDay() + 7) % 7
  if (daysUntil === 0) return fromDate
  d.setDate(d.getDate() + daysUntil)
  return d.toISOString().slice(0, 10)
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function expandTx(tx, startDate, endDate) {
  const ws = new Date(startDate + 'T00:00:00')
  const we = new Date(endDate + 'T23:59:59')
  const txStart = new Date(tx.date + 'T00:00:00')
  const txEnd = tx.end_date ? new Date(tx.end_date + 'T23:59:59') : null
  const out = []
  if (!tx.recurrence || tx.recurrence === 'once') {
    if (txStart >= ws && txStart <= we) out.push(tx.date)
    return out
  }
  let cur = new Date(txStart), safety = 0
  while (cur <= we && safety++ < 500) {
    if (txEnd && cur > txEnd) break
    if (cur >= ws) out.push(cur.toISOString().slice(0, 10))
    if (tx.recurrence === 'weekly')       cur.setDate(cur.getDate() + 7)
    else if (tx.recurrence === 'biweekly') cur.setDate(cur.getDate() + 14)
    else if (tx.recurrence === 'monthly')  cur.setMonth(cur.getMonth() + 1)
    else break
  }
  return out
}

// ─── ENVELOPE CARD ────────────────────────────────────────────────────────────
function EnvelopeCard({ env, onUpdateSpent }) {
  const allocated = parseFloat(env.allocated_amount) || 0
  const spent = parseFloat(env.spent_amount) || 0
  const remaining = allocated - spent
  const pct = allocated > 0 ? Math.min(100, (spent / allocated) * 100) : 0
  const isOver = spent > allocated
  const barColor = isOver ? C.red : pct > 80 ? C.orange : C.green
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(String(spent.toFixed(2)))

  function save() {
    onUpdateSpent(env.id, parseFloat(val) || 0)
    setEditing(false)
  }

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {env.color && <div style={{ width: 10, height: 10, borderRadius: '50%', background: env.color, flexShrink: 0 }} />}
          <span style={{ fontSize: 14, fontWeight: 600 }}>{env.name}</span>
        </div>
        <span style={{ fontSize: 12, color: isOver ? C.red : remaining < 20 ? C.orange : C.textMid }}>
          {fmt(remaining)} left
        </span>
      </div>

      <div style={{ height: 6, background: C.surfaceHigh, borderRadius: 3, marginBottom: 8, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: C.textLow }}>{fmt(spent)} of {fmt(allocated)}</span>
        {editing ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              style={{ ...S.inp, width: 90, padding: '5px 8px', fontSize: 13 }}
              type="number" step="0.01" value={val}
              onChange={e => setVal(e.target.value)}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
            />
            <button style={S.btn(C.green)} onClick={save}>✓</button>
            <button style={S.btn(C.surfaceHigh, true)} onClick={() => setEditing(false)}>✕</button>
          </div>
        ) : (
          <button
            onClick={() => { setVal(String(spent.toFixed(2))); setEditing(true) }}
            style={{ fontSize: 11, color: C.purple, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Update spent
          </button>
        )}
      </div>
    </div>
  )
}

// ─── TEMPLATE MANAGER ────────────────────────────────────────────────────────
function TemplateRow({ template, onRemove, onUpdateAmount }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(String(parseFloat(template.default_amount).toFixed(2)))

  function save() {
    onUpdateAmount(template.id, parseFloat(val) || 0)
    setEditing(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
      <span style={{ flex: 1, fontSize: 14 }}>{template.name}</span>
      {editing ? (
        <>
          <input
            style={{ ...S.inp, width: 90, padding: '5px 8px', fontSize: 13 }}
            type="number" step="0.01" value={val}
            onChange={e => setVal(e.target.value)}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
          />
          <button style={S.btn(C.green)} onClick={save}>✓</button>
        </>
      ) : (
        <button
          onClick={() => setEditing(true)}
          style={{ fontSize: 13, color: C.textMid, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {fmt(template.default_amount)}
        </button>
      )}
      <button onClick={() => onRemove(template.id)} style={{ background: 'none', border: 'none', color: C.textLow, cursor: 'pointer', fontSize: 18, flexShrink: 0 }}>×</button>
    </div>
  )
}

function TemplateManager({ bookId, templates, onDone }) {
  const [list, setList] = useState(templates)
  const [newName, setNewName] = useState('')
  const [newAmt, setNewAmt] = useState('')
  const [saving, setSaving] = useState(false)

  async function add() {
    if (!newName || !newAmt) return
    setSaving(true)
    const { data, error } = await supabase.from('envelope_templates').insert({
      book_id: bookId, name: newName,
      default_amount: parseFloat(newAmt), display_order: list.length,
    }).select().single()
    setSaving(false)
    if (!error && data) { setList(prev => [...prev, data]); setNewName(''); setNewAmt('') }
  }

  async function remove(id) {
    await supabase.from('envelope_templates').delete().eq('id', id)
    setList(prev => prev.filter(t => t.id !== id))
  }

  async function updateAmount(id, amt) {
    await supabase.from('envelope_templates').update({ default_amount: amt }).eq('id', id)
    setList(prev => prev.map(t => t.id === id ? { ...t, default_amount: amt } : t))
  }

  return (
    <div style={S.sheet}>
      <div style={S.sheetInner}>
        <div style={S.sheetHeader}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Envelope Templates</span>
          <button onClick={onDone} style={{ background: 'none', border: 'none', color: C.textMid, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '12px 18px' }}>
          {list.map(t => (
            <TemplateRow key={t.id} template={t} onRemove={remove} onUpdateAmount={updateAmount} />
          ))}
          {list.length === 0 && (
            <div style={{ color: C.textLow, fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No templates yet</div>
          )}
          <div style={{ marginTop: 16 }}>
            <div style={S.lbl}>Add template</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...S.inp, flex: 2 }} placeholder="e.g. Groceries" value={newName} onChange={e => setNewName(e.target.value)} />
              <input style={{ ...S.inp, flex: 1 }} type="number" step="0.01" placeholder="$0" value={newAmt} onChange={e => setNewAmt(e.target.value)} />
              <button style={S.btn(C.purple)} onClick={add} disabled={saving}>+</button>
            </div>
          </div>
        </div>
        <div style={{ padding: '12px 18px 28px', borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
          <button style={{ ...S.btn(C.purple), width: '100%' }} onClick={onDone}>Done</button>
        </div>
      </div>
    </div>
  )
}

// ─── CREATE CYCLE MODAL ───────────────────────────────────────────────────────
function CreateCycleModal({ bookId, accounts, transactions, templates, onSave, onClose }) {
  const today = todayStr()
  const defaultStart = nextFriday(today)
  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate, setEndDate] = useState(addDays(defaultStart, 13))
  const [startingBalance, setStartingBalance] = useState(() => {
    const main = accounts.find(a => a.name?.toLowerCase().includes('simplii'))
              || accounts.find(a => a.type !== 'credit')
              || accounts[0]
    return main ? String(parseFloat(main.balance || 0).toFixed(2)) : '0'
  })
  const [step, setStep] = useState(1)
  const [allocs, setAllocs] = useState(() =>
    templates.map(t => ({ template_id: t.id, name: t.name, amount: String(parseFloat(t.default_amount).toFixed(2)), color: t.color || null }))
  )
  const [saving, setSaving] = useState(false)

  function handleStartChange(val) {
    setStartDate(val)
    setEndDate(addDays(val, 13))
  }

  const { incomeInRange, billsInRange, billsList } = useMemo(() => {
    let income = 0, bills = 0
    const billsList = []
    for (const tx of transactions) {
      const dates = expandTx(tx, startDate, endDate)
      if (!dates.length) continue
      const amt = parseFloat(tx.amount) || 0
      if (tx.type === 'income') {
        income += amt * dates.length
      } else if (tx.type === 'expense') {
        bills += amt * dates.length
        dates.forEach(d => billsList.push({ label: tx.label, date: d, amount: amt }))
      }
    }
    return { incomeInRange: income, billsInRange: bills, billsList: billsList.sort((a, b) => a.date.localeCompare(b.date)) }
  }, [transactions, startDate, endDate])

  const startBal = parseFloat(startingBalance) || 0
  const available = startBal + incomeInRange - billsInRange
  const totalAllocated = allocs.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0)
  const unallocated = available - totalAllocated

  async function save() {
    setSaving(true)
    const { data: cycle, error } = await supabase.from('pay_cycles').insert({
      book_id: bookId, start_date: startDate, end_date: endDate,
      starting_balance: startBal, income_actual: incomeInRange,
    }).select().single()
    if (error || !cycle) { setSaving(false); return }

    const rows = allocs.filter(a => a.name && parseFloat(a.amount) > 0).map(a => ({
      cycle_id: cycle.id, template_id: a.template_id || null,
      name: a.name, allocated_amount: parseFloat(a.amount), spent_amount: 0, color: a.color,
    }))
    if (rows.length > 0) await supabase.from('cycle_envelopes').insert(rows)
    setSaving(false)
    onSave()
  }

  if (step === 1) return (
    <div style={S.sheet}>
      <div style={S.sheetInner}>
        <div style={S.sheetHeader}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>New Pay Cycle</div>
            <div style={{ fontSize: 11, color: C.textLow, marginTop: 2 }}>Step 1 of 2 — Dates & balance</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMid, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 18px' }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={S.lbl}>Cycle start</div>
              <input style={S.inp} type="date" value={startDate} onChange={e => handleStartChange(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={S.lbl}>Cycle end</div>
              <input style={S.inp} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={S.lbl}>Starting balance</div>
            <input style={S.inp} type="number" step="0.01" value={startingBalance} onChange={e => setStartingBalance(e.target.value)} />
          </div>

          {/* Cycle math summary */}
          <div style={{ background: C.surfaceHigh, borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: C.textLow }}>Starting balance</span>
              <span style={{ fontSize: 12 }}>{fmt(startBal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: C.green }}>+ Income this cycle</span>
              <span style={{ fontSize: 12, color: C.green }}>+{fmt(incomeInRange)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 12, color: C.red }}>− Fixed bills</span>
              <span style={{ fontSize: 12, color: C.red }}>−{fmt(billsInRange)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Variable available</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: available >= 0 ? C.green : C.red }}>{fmt(available)}</span>
            </div>
          </div>

          {billsList.length > 0 && (
            <>
              <div style={S.secHead(C.red)}>Bills included above</div>
              {billsList.map((b, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                  <span style={{ color: C.textMid }}>{b.label}</span>
                  <span style={{ color: C.red }}>−{fmt(b.amount)}</span>
                </div>
              ))}
            </>
          )}
        </div>
        <div style={{ padding: '12px 18px 28px', borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
          <button style={{ ...S.btn(C.purple), width: '100%' }} onClick={() => setStep(2)}>
            Next: allocate envelopes →
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div style={S.sheet}>
      <div style={S.sheetInner}>
        <div style={S.sheetHeader}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>New Pay Cycle</div>
            <div style={{ fontSize: 11, color: C.textLow, marginTop: 2 }}>Step 2 of 2 — Envelope allocation</div>
          </div>
          <button onClick={() => setStep(1)} style={{ background: 'none', border: 'none', color: C.purple, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>← back</button>
        </div>

        {/* Sticky available/unallocated bar */}
        <div style={{ padding: '10px 18px', background: C.surfaceHigh, flexShrink: 0, display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 9, color: C.textLow, textTransform: 'uppercase', letterSpacing: 1 }}>Available</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{fmt(available)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: C.textLow, textTransform: 'uppercase', letterSpacing: 1 }}>Unallocated</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: unallocated < 0 ? C.red : unallocated < 50 ? C.orange : C.green }}>
              {fmt(unallocated)}
            </div>
          </div>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '12px 18px' }}>
          {allocs.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
              <input
                style={{ ...S.inp, flex: 2 }}
                placeholder="Envelope name"
                value={a.name}
                onChange={e => setAllocs(prev => prev.map((x, xi) => xi === i ? { ...x, name: e.target.value } : x))}
              />
              <input
                style={{ ...S.inp, flex: 1 }}
                type="number" step="0.01" placeholder="0.00"
                value={a.amount}
                onChange={e => setAllocs(prev => prev.map((x, xi) => xi === i ? { ...x, amount: e.target.value } : x))}
              />
              <button
                onClick={() => setAllocs(prev => prev.filter((_, xi) => xi !== i))}
                style={{ background: 'none', border: 'none', color: C.textLow, cursor: 'pointer', fontSize: 18, flexShrink: 0 }}
              >×</button>
            </div>
          ))}
          <button
            onClick={() => setAllocs(prev => [...prev, { name: '', amount: '', color: null }])}
            style={{ width: '100%', background: 'none', border: `1px dashed ${C.border}`, borderRadius: 8, color: C.textLow, fontSize: 12, padding: '10px 0', cursor: 'pointer', fontFamily: 'inherit', marginTop: 4, marginBottom: 16 }}
          >
            + Add envelope
          </button>
        </div>
        <div style={{ padding: '12px 18px 28px', borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
          <button style={{ ...S.btn(C.green), width: '100%', opacity: saving ? 0.7 : 1 }} onClick={save} disabled={saving}>
            {saving ? 'Creating…' : 'Start cycle ✓'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── AUTO-CREATE PREVIEW MODAL ────────────────────────────────────────────────
function AutoCreatePreviewModal({ bookId, accounts, transactions, templates, overrides, onCreated, onClose }) {
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)

  const approvedIncome = useMemo(() => findApprovedMainIncome(transactions, overrides), [transactions, overrides])
  const cycleWindow = useMemo(() => approvedIncome ? calculateCycleWindow(approvedIncome.date) : null, [approvedIncome])

  const previewData = useMemo(() => {
    if (!approvedIncome || !cycleWindow) return null
    const { startDate, endDate } = cycleWindow

    const bills = identifyFixedBillsInWindow(transactions, startDate, endDate)
    const totalBills = bills.reduce((s, b) => s + b.amount, 0)

    const primaryAcct = accounts.find(a => a.name?.toLowerCase().includes('simplii')) ||
      accounts.find(a => a.type !== 'credit') ||
      accounts[0]
    const startBal = parseFloat(primaryAcct?.balance || 0)
    const mainIncome = parseFloat(approvedIncome.tx.amount) || 0
    const variable = startBal + mainIncome - totalBills

    const allocs = suggestEnvelopeAllocations(variable, templates)
    const daysLeft = Math.max(1, Math.round((new Date(endDate + 'T23:59:59') - new Date()) / 86400000) + 1)

    return {
      startDate,
      endDate,
      daysLeft,
      startingBalance: startBal,
      incomeAmount: mainIncome,
      bills,
      totalBills,
      variable,
      allocations: allocs.map(a => ({ name: a.name, suggested: a.allocated_amount })),
    }
  }, [approvedIncome, cycleWindow, transactions, accounts, templates])

  async function handleCreate() {
    setCreating(true)
    setError(null)
    const result = await createCycleFromApprovedPaycheck(bookId, accounts, transactions, templates, overrides)
    setCreating(false)

    if (result.success) {
      onCreated()
    } else {
      setError(result.error)
    }
  }

  if (!previewData) {
    return (
      <div style={S.sheet} onClick={onClose}>
        <div style={S.sheetInner} onClick={e => e.stopPropagation()}>
          <div style={S.sheetHeader}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>Loading preview…</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMid, fontSize: 22, cursor: 'pointer' }}>×</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={S.sheet} onClick={onClose}>
      <div style={S.sheetInner} onClick={e => e.stopPropagation()}>
        <div style={S.sheetHeader}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Ready to create cycle?</div>
            <div style={{ fontSize: 11, color: C.textLow, marginTop: 2 }}>Review details before committing</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMid, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '14px 16px' }}>
          {/* Cycle dates & days left */}
          <div style={{ ...S.card, background: C.surfaceHigh, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: C.textLow, textTransform: 'uppercase', letterSpacing: 1 }}>Cycle period</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 3 }}>
                  {new Date(previewData.startDate + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                  {' – '}
                  {new Date(previewData.endDate + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1 }}>{previewData.daysLeft}</div>
                <div style={{ fontSize: 10, color: C.textLow }}>days</div>
              </div>
            </div>
          </div>

          {/* Safe to spend summary */}
          <div style={{ ...S.card, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: C.textLow, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10 }}>Safe to spend before next income</div>
            {[
              { label: 'Starting balance', value: fmt(previewData.startingBalance), color: C.text },
              { label: '+ Income', value: `+${fmt(previewData.incomeAmount)}`, color: C.green },
              { label: '− Fixed bills', value: `−${fmt(previewData.totalBills)}`, color: C.red },
            ].map((row, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 13, color: C.textMid }}>{row.label}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: row.color }}>{row.value}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, padding: '10px 12px', background: previewData.variable < 0 ? C.redBg : C.greenBg, border: `1px solid ${previewData.variable < 0 ? C.red : C.green}`, borderRadius: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: previewData.variable < 0 ? C.red : C.green, textTransform: 'uppercase', letterSpacing: 1 }}>Safe to spend</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: previewData.variable < 0 ? C.red : C.green }}>{fmt(previewData.variable)}</span>
            </div>
          </div>

          {/* Bills breakdown */}
          {previewData.bills.length > 0 && (
            <>
              <div style={{ ...S.secHead(C.red), marginBottom: 8, marginTop: 16 }}>Fixed bills this cycle</div>
              <div style={S.card}>
                {previewData.bills.map((b, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < previewData.bills.length - 1 ? `1px solid ${C.border}` : 'none', fontSize: 13 }}>
                    <div>
                      <span style={{ fontWeight: 500 }}>{b.label}</span>
                      <div style={{ fontSize: 10, color: C.textLow, marginTop: 2 }}>
                        {new Date(b.date + 'T00:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </div>
                    </div>
                    <span style={{ color: C.red }}>−{fmt(b.amount)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Suggested envelope allocations */}
          {previewData.allocations.length > 0 && (
            <>
              <div style={{ ...S.secHead(C.purple), marginBottom: 8, marginTop: 16 }}>Suggested envelope amounts</div>
              <div style={S.card}>
                {previewData.allocations.map((a, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < previewData.allocations.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{a.name}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.purple }}>{fmt(a.suggested)}</span>
                  </div>
                ))}
              </div>
              {previewData.variable < 0 && (
                <div style={{ ...S.card, background: C.redBg, border: `1px solid ${C.border}`, marginTop: 8 }}>
                  <div style={{ fontSize: 12, color: C.red }}>
                    ⚠️ Budget is negative. Fixed bills exceed available funds. Create anyway?
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ padding: '12px 16px 24px', borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
          {error && (
            <div style={{ ...S.card, background: C.redBg, border: `1px solid ${C.border}`, marginBottom: 10, fontSize: 12 }}>
              {error}
            </div>
          )}
          <button
            onClick={handleCreate}
            disabled={creating}
            style={{ ...S.btn(C.green), width: '100%', opacity: creating ? 0.7 : 1 }}
          >
            {creating ? 'Creating…' : 'Create cycle ✓'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── MAIN CYCLES TAB ─────────────────────────────────────────────────────────
export default function CyclesTab({ bookId, accounts, transactions }) {
  const today = todayStr()
  const [cycle, setCycle] = useState(null)
  const [envelopes, setEnvelopes] = useState([])
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showAutoPreview, setShowAutoPreview] = useState(false)
  const [overrides, setOverrides] = useState([])

  useEffect(() => { load() }, [bookId])

  async function load() {
    setLoading(true)
    const [{ data: cycles }, { data: tmpl }, { data: ovr }] = await Promise.all([
      supabase.from('pay_cycles').select('*').eq('book_id', bookId).order('start_date', { ascending: false }).limit(1),
      supabase.from('envelope_templates').select('*').eq('book_id', bookId).order('display_order'),
      supabase.from('cashflow_overrides').select('*').eq('book_id', bookId),
    ])
    const latest = cycles?.[0] || null
    setCycle(latest)
    setTemplates(tmpl || [])
    setOverrides(ovr || [])
    if (latest) {
      const { data: envs } = await supabase.from('cycle_envelopes').select('*').eq('cycle_id', latest.id)
      setEnvelopes(envs || [])
    }
    setLoading(false)
  }

  async function updateEnvelopeSpent(envId, newSpent) {
    await supabase.from('cycle_envelopes').update({ spent_amount: newSpent }).eq('id', envId)
    setEnvelopes(prev => prev.map(e => e.id === envId ? { ...e, spent_amount: newSpent } : e))
  }

  const approvedMainIncome = useMemo(() => findApprovedMainIncome(transactions, overrides), [transactions, overrides])

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
      <div style={{ width: 24, height: 24, border: `2px solid ${C.border}`, borderTop: `2px solid ${C.purple}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    </div>
  )

  // Cycle stats
  const stats = cycle ? (() => {
    const start = new Date(cycle.start_date + 'T00:00:00')
    const end = new Date(cycle.end_date + 'T00:00:00')
    const now = new Date(); now.setHours(0, 0, 0, 0)
    const totalDays = Math.round((end - start) / 86400000) + 1
    const daysLeft = Math.max(0, Math.round((end - now) / 86400000) + 1)
    const pct = totalDays > 0 ? Math.min(100, ((totalDays - daysLeft) / totalDays) * 100) : 0
    const allocated = envelopes.reduce((s, e) => s + (parseFloat(e.allocated_amount) || 0), 0)
    const spent = envelopes.reduce((s, e) => s + (parseFloat(e.spent_amount) || 0), 0)
    return { totalDays, daysLeft, pct, allocated, spent, safeToSpend: allocated - spent }
  })() : null

  // Bills still remaining in this cycle (from today forward)
  const billsRemaining = cycle ? (() => {
    const list = []
    for (const tx of transactions.filter(t => t.type === 'expense')) {
      for (const d of expandTx(tx, today, cycle.end_date)) {
        list.push({ tx, date: d, amount: parseFloat(tx.amount) || 0 })
      }
    }
    return list.sort((a, b) => a.date.localeCompare(b.date))
  })() : []

  const isActive = cycle && today >= cycle.start_date && today <= cycle.end_date
  const isPast = cycle && today > cycle.end_date

  return (
    <div style={{ padding: '16px 16px 0' }}>
      {!cycle ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⊙</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No active pay cycle</div>
          <div style={{ fontSize: 13, color: C.textLow, marginBottom: 24, lineHeight: 1.5 }}>
            Set up your first cycle to start tracking envelopes and safe-to-spend
          </div>
          {approvedMainIncome ? (
            <>
              <button style={{ ...S.btn(C.green), marginBottom: 12, width: '100%', maxWidth: 240 }} onClick={() => setShowAutoPreview(true)}>
                Auto-create from paycheck ✓
              </button>
              <div style={{ fontSize: 11, color: C.textLow, marginBottom: 16 }}>or</div>
            </>
          ) : null}
          <button style={{ ...S.btn(C.purple), marginBottom: 16 }} onClick={() => setShowCreate(true)}>
            Start new cycle manually
          </button>
          <div>
            <button
              style={{ fontSize: 12, color: C.textLow, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
              onClick={() => setShowTemplates(true)}
            >
              Manage envelope templates first
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Cycle header card */}
          <div style={{ ...S.card, background: C.surfaceHigh }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: C.textLow, textTransform: 'uppercase', letterSpacing: 2 }}>
                  {isPast ? 'Past cycle' : isActive ? 'Current cycle' : 'Upcoming cycle'}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 3 }}>
                  {new Date(cycle.start_date + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                  {' – '}
                  {new Date(cycle.end_date + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                </div>
              </div>
              {isActive && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: stats.daysLeft <= 3 ? C.orange : C.text, lineHeight: 1 }}>{stats.daysLeft}</div>
                  <div style={{ fontSize: 10, color: C.textLow }}>days left</div>
                </div>
              )}
            </div>

            {isActive && (
              <div style={{ height: 4, background: C.border, borderRadius: 2, marginBottom: 12, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${stats.pct}%`, background: C.purple, borderRadius: 2 }} />
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, background: C.surface, borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: C.textLow, textTransform: 'uppercase', letterSpacing: 1 }}>Allocated</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{fmt(stats.allocated)}</div>
              </div>
              <div style={{ flex: 1, background: C.surface, borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: C.textLow, textTransform: 'uppercase', letterSpacing: 1 }}>Spent</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.red }}>{fmt(stats.spent)}</div>
              </div>
              <div style={{
                flex: 1, borderRadius: 8, padding: '8px 10px', textAlign: 'center',
                background: stats.safeToSpend < 0 ? C.redBg : stats.safeToSpend < 50 ? '#431407' : C.greenBg,
                border: `1px solid ${stats.safeToSpend < 0 ? C.red : stats.safeToSpend < 50 ? C.orange : C.green}`,
              }}>
                <div style={{ fontSize: 9, color: stats.safeToSpend < 0 ? C.red : stats.safeToSpend < 50 ? C.orange : C.green, textTransform: 'uppercase', letterSpacing: 1 }}>
                  Safe to spend
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: stats.safeToSpend < 0 ? C.red : stats.safeToSpend < 50 ? C.orange : C.green }}>
                  {fmt(stats.safeToSpend)}
                </div>
              </div>
            </div>
          </div>

          {/* Envelopes */}
          {envelopes.length > 0 && (
            <>
              <div style={S.secHead(C.purple)}>Envelopes</div>
              {envelopes.map(env => (
                <EnvelopeCard key={env.id} env={env} onUpdateSpent={updateEnvelopeSpent} />
              ))}
            </>
          )}
          {envelopes.length === 0 && (
            <div style={{ ...S.card, textAlign: 'center', color: C.textLow, fontSize: 13, padding: 20 }}>
              No envelopes for this cycle
            </div>
          )}

          {/* Bills remaining */}
          {billsRemaining.length > 0 && (
            <>
              <div style={S.secHead(C.red)}>Bills remaining this cycle</div>
              <div style={S.card}>
                {billsRemaining.map((b, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: i < billsRemaining.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{b.tx.label}</div>
                      <div style={{ fontSize: 11, color: C.textLow }}>
                        {new Date(b.date + 'T00:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </div>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.red }}>−{fmt(b.amount)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 4, marginBottom: 20 }}>
            <button style={{ ...S.btn(C.purple), flex: 1 }} onClick={() => setShowCreate(true)}>New cycle</button>
            <button style={{ ...S.btn(C.surfaceHigh, true), flex: 1 }} onClick={() => setShowTemplates(true)}>Templates</button>
          </div>
        </>
      )}

      {showCreate && (
        <CreateCycleModal
          bookId={bookId} accounts={accounts} transactions={transactions} templates={templates}
          onSave={() => { setShowCreate(false); load() }}
          onClose={() => setShowCreate(false)}
        />
      )}
      {showAutoPreview && (
        <AutoCreatePreviewModal
          bookId={bookId} accounts={accounts} transactions={transactions} templates={templates} overrides={overrides}
          onCreated={() => { setShowAutoPreview(false); load() }}
          onClose={() => setShowAutoPreview(false)}
        />
      )}
      {showTemplates && (
        <TemplateManager
          bookId={bookId} templates={templates}
          onDone={() => { setShowTemplates(false); load() }}
        />
      )}
    </div>
  )
}
