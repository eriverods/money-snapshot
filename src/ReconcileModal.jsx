import { useState, useMemo } from 'react'

const C = {
  bg: '#0a0f1a', surface: '#111827', surfaceHigh: '#1e293b',
  border: '#1e293b', text: '#f1f5f9', textMid: '#94a3b8', textLow: '#475569',
  green: '#4ade80', red: '#f87171', orange: '#f97316', purple: '#a78bfa', blue: '#38bdf8',
}
const S = {
  inp: { background: '#0f172a', border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', color: C.text, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' },
  lbl: { fontSize: 10, color: C.textLow, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 3 },
  btn: (bg) => ({ background: bg || C.purple, border: 'none', borderRadius: 8, padding: '10px 16px', color: bg === C.surfaceHigh ? C.textMid : '#0a0f1a', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }),
}

function expandTxLocal(tx, startDate, endDate) {
  const ws = new Date(startDate + 'T00:00:00')
  const we = new Date(endDate + 'T23:59:59')
  const txStart = new Date(tx.date + 'T00:00:00')
  const txEnd = tx.end_date ? new Date(tx.end_date + 'T23:59:59') : null
  const instances = []
  if (!tx.recurrence || tx.recurrence === 'once') {
    if (txStart >= ws && txStart <= we) instances.push(tx.date)
    return instances
  }
  let cur = new Date(txStart), safety = 0
  while (cur <= we && safety++ < 500) {
    if (txEnd && cur > txEnd) break
    if (cur >= ws) instances.push(cur.toISOString().slice(0, 10))
    if (tx.recurrence === 'weekly')       cur.setDate(cur.getDate() + 7)
    else if (tx.recurrence === 'biweekly') cur.setDate(cur.getDate() + 14)
    else if (tx.recurrence === 'monthly')  cur.setMonth(cur.getMonth() + 1)
    else break
  }
  return instances
}

function fmt(val) {
  const n = parseFloat(val)
  if (isNaN(n)) return ''
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n)
}

export default function ReconcileModal({ account, transactions, overrides, onSave, onClose }) {
  const today = new Date().toISOString().slice(0, 10)
  const baselineDate = account.baseline_date || account.created_at?.slice(0, 10) || today
  const baselineBalance = parseFloat(account.balance) || 0

  const [actualBalance, setActualBalance] = useState(String(baselineBalance.toFixed(2)))
  const [states, setStates] = useState({})     // key: `${txId}:${date}` → 'approved'|'skipped'|'modified'
  const [amounts, setAmounts] = useState({})   // key: `${txId}:${date}` → string amount
  const [newTxs, setNewTxs] = useState([])     // [{label, amount, type}]
  const [saving, setSaving] = useState(false)

  // Build all relevant instances for this account between baseline and today
  const relevantTxs = useMemo(() =>
    transactions.filter(tx =>
      tx.account === account.name &&
      new Date(tx.date + 'T00:00:00') <= new Date(today + 'T23:59:59')
    ), [transactions, account.name, today])

  const instances = useMemo(() => {
    const all = []
    for (const tx of relevantTxs) {
      const dates = expandTxLocal(tx, baselineDate, today)
      for (const d of dates) {
        const key = `${tx.id}:${d}`
        const existingOverride = overrides.find(o => String(o.transaction_id) === String(tx.id) && o.instance_date === d)
        all.push({ tx, date: d, key, existingState: existingOverride?.action || 'projected', existingAmount: existingOverride?.modified_amount })
      }
    }
    return all.sort((a, b) => a.date.localeCompare(b.date))
  }, [relevantTxs, baselineDate, today, overrides])

  // Pre-populate states from existing overrides on first render
  useMemo(() => {
    const s = {}, a = {}
    for (const inst of instances) {
      if (inst.existingState !== 'projected') {
        s[inst.key] = inst.existingState
        if (inst.existingState === 'modified' && inst.existingAmount != null) {
          a[inst.key] = String(inst.existingAmount)
        }
      }
    }
    setStates(s)
    setAmounts(a)
  }, [instances])

  function getState(key, existingState) {
    return states[key] ?? existingState
  }

  function toggleApprove(key) {
    setStates(prev => {
      const cur = prev[key] ?? instances.find(i => i.key === key)?.existingState ?? 'projected'
      if (cur === 'approved') return { ...prev, [key]: 'projected' }
      return { ...prev, [key]: 'approved' }
    })
  }

  function toggleSkip(key) {
    setStates(prev => {
      const cur = prev[key] ?? instances.find(i => i.key === key)?.existingState ?? 'projected'
      if (cur === 'skipped') return { ...prev, [key]: 'projected' }
      return { ...prev, [key]: 'skipped' }
    })
  }

  function setModified(key, val) {
    setAmounts(prev => ({ ...prev, [key]: val }))
    if (val) setStates(prev => ({ ...prev, [key]: 'modified' }))
  }

  // Compute the running calculation
  const { approvedTotal, unexplained } = useMemo(() => {
    let total = 0
    for (const inst of instances) {
      const state = getState(inst.key, inst.existingState)
      if (state === 'skipped') continue
      const amt = state === 'modified'
        ? (parseFloat(amounts[inst.key]) || 0)
        : (parseFloat(inst.tx.amount) || 0)
      const signed = inst.tx.type === 'income' ? amt : -amt
      if (state === 'approved' || state === 'modified') total += signed
    }
    // Add new transactions
    for (const nt of newTxs) {
      const amt = parseFloat(nt.amount) || 0
      total += nt.type === 'income' ? amt : -amt
    }
    const expected = baselineBalance + total
    const actual = parseFloat(actualBalance) || 0
    return { approvedTotal: total, unexplained: actual - expected }
  }, [instances, states, amounts, newTxs, baselineBalance, actualBalance])

  function addNewTx() {
    setNewTxs(prev => [...prev, { label: '', amount: '', type: 'expense' }])
  }

  function updateNewTx(i, field, val) {
    setNewTxs(prev => prev.map((t, idx) => idx === i ? { ...t, [field]: val } : t))
  }

  function removeNewTx(i) {
    setNewTxs(prev => prev.filter((_, idx) => idx !== i))
  }

  async function handleSave(ignoreUnexplained = false) {
    if (Math.abs(unexplained) > 0.01 && !ignoreUnexplained) return
    setSaving(true)
    const overridesToWrite = instances.map(inst => {
      const state = getState(inst.key, inst.existingState)
      if (state === 'projected') return null
      return {
        transaction_id: inst.tx.id,
        instance_date: inst.date,
        action: state,
        modified_amount: state === 'modified' ? (parseFloat(amounts[inst.key]) || null) : null,
      }
    }).filter(Boolean)
    await onSave({
      newBalance: parseFloat(actualBalance) || 0,
      newBaselineDate: today,
      overrides: overridesToWrite,
      newTransactions: newTxs.filter(t => t.label && t.amount),
    })
    setSaving(false)
  }

  // Group instances by date for display
  const byDate = useMemo(() => {
    const map = new Map()
    for (const inst of instances) {
      if (!map.has(inst.date)) map.set(inst.date, [])
      map.get(inst.date).push(inst)
    }
    return Array.from(map.entries())
  }, [instances])

  const unexplainedZero = Math.abs(unexplained) < 0.01

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 1000, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ background: C.surface, borderRadius: '20px 20px 0 0', maxHeight: '94vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: '20px 18px 12px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Reconcile {account.name}</div>
              <div style={{ fontSize: 11, color: C.textLow, marginTop: 2 }}>
                Transactions since {new Date(baselineDate + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMid, fontSize: 22, cursor: 'pointer', padding: '0 4px' }}>×</button>
          </div>

          {/* Actual balance input */}
          <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <div style={S.lbl}>Current actual balance</div>
              <input
                style={{ ...S.inp, fontSize: 18, fontWeight: 700, width: '100%' }}
                type="number"
                step="0.01"
                placeholder="0.00"
                value={actualBalance}
                onChange={e => setActualBalance(e.target.value)}
                autoFocus
              />
            </div>
            <div style={{ textAlign: 'right', paddingBottom: 2 }}>
              <div style={{ fontSize: 10, color: C.textLow }}>Baseline</div>
              <div style={{ fontSize: 14, color: C.textMid, fontWeight: 600 }}>{fmt(baselineBalance)}</div>
            </div>
          </div>

          {/* Live calc strip */}
          <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
            <div style={{ flex: 1, background: C.surfaceHigh, borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: C.textLow, textTransform: 'uppercase', letterSpacing: 1 }}>Expected</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.textMid }}>{fmt(baselineBalance + approvedTotal)}</div>
            </div>
            <div style={{ flex: 1, background: unexplainedZero ? '#064e3b' : '#450a0a', borderRadius: 8, padding: '8px 10px', textAlign: 'center', border: `1px solid ${unexplainedZero ? C.green : C.red}` }}>
              <div style={{ fontSize: 9, color: unexplainedZero ? C.green : C.red, textTransform: 'uppercase', letterSpacing: 1 }}>Unexplained</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: unexplainedZero ? C.green : C.red }}>
                {unexplainedZero ? '✓ $0' : (unexplained > 0 ? '+' : '') + fmt(unexplained)}
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '0 18px' }}>
          {instances.length === 0 && (
            <div style={{ textAlign: 'center', color: C.textLow, padding: '30px 0', fontSize: 13 }}>
              No transactions recorded since {baselineDate}
            </div>
          )}

          {byDate.map(([date, insts]) => (
            <div key={date}>
              <div style={{ fontSize: 10, color: C.textLow, textTransform: 'uppercase', letterSpacing: 2, padding: '14px 0 6px', fontWeight: 700 }}>
                {new Date(date + 'T00:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}
              </div>
              {insts.map(inst => {
                const state = getState(inst.key, inst.existingState)
                const isSkipped = state === 'skipped'
                const isApproved = state === 'approved'
                const isModified = state === 'modified'
                const isIncome = inst.tx.type === 'income'
                return (
                  <div key={inst.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: `1px solid ${C.border}`, opacity: isSkipped ? 0.4 : 1 }}>
                    {/* Approve checkbox */}
                    <button
                      onClick={() => toggleApprove(inst.key)}
                      style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${isApproved || isModified ? C.green : C.border}`, background: isApproved || isModified ? C.green : 'transparent', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}
                    >
                      {(isApproved || isModified) && <span style={{ color: '#0a0f1a', fontWeight: 700 }}>✓</span>}
                    </button>

                    {/* Label */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: isSkipped ? C.textLow : C.text, textDecoration: isSkipped ? 'line-through' : 'none', fontStyle: state === 'projected' ? 'italic' : 'normal' }}>
                        {inst.tx.label}
                      </div>
                      <div style={{ fontSize: 10, color: C.textLow }}>{inst.tx.type}</div>
                    </div>

                    {/* Modified amount input */}
                    <input
                      style={{ ...S.inp, width: 80, textAlign: 'right', fontSize: 13 }}
                      type="number"
                      step="0.01"
                      value={isModified ? (amounts[inst.key] ?? '') : (amounts[inst.key] || String(inst.tx.amount))}
                      onChange={e => setModified(inst.key, e.target.value)}
                      onFocus={e => { if (!isModified) e.target.select() }}
                    />

                    {/* Amount display */}
                    <div style={{ fontSize: 13, fontWeight: 700, color: isIncome ? C.green : C.red, width: 70, textAlign: 'right', flexShrink: 0 }}>
                      {isIncome ? '+' : '-'}{fmt(isModified ? (parseFloat(amounts[inst.key]) || 0) : inst.tx.amount)}
                    </div>

                    {/* Skip */}
                    <button
                      onClick={() => toggleSkip(inst.key)}
                      style={{ background: 'none', border: 'none', color: isSkipped ? C.orange : C.textLow, cursor: 'pointer', fontSize: 11, padding: '0 2px', flexShrink: 0 }}
                      title={isSkipped ? 'Unskip' : 'Skip'}
                    >
                      {isSkipped ? '↩' : '⊘'}
                    </button>
                  </div>
                )
              })}
            </div>
          ))}

          {/* New transactions */}
          {newTxs.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: C.orange, textTransform: 'uppercase', letterSpacing: 2, padding: '10px 0 6px', fontWeight: 700 }}>New transactions</div>
              {newTxs.map((nt, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
                  <input style={{ ...S.inp, flex: 2 }} placeholder="Label" value={nt.label} onChange={e => updateNewTx(i, 'label', e.target.value)} />
                  <select style={{ ...S.inp, flex: 1 }} value={nt.type} onChange={e => updateNewTx(i, 'type', e.target.value)}>
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                    <option value="transfer">Transfer</option>
                  </select>
                  <input style={{ ...S.inp, flex: 1 }} type="number" step="0.01" placeholder="0.00" value={nt.amount} onChange={e => updateNewTx(i, 'amount', e.target.value)} />
                  <button onClick={() => removeNewTx(i)} style={{ background: 'none', border: 'none', color: C.red, cursor: 'pointer', fontSize: 18 }}>×</button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={addNewTx}
            style={{ width: '100%', background: 'none', border: `1px dashed ${C.border}`, borderRadius: 8, color: C.textLow, fontSize: 12, padding: '10px 0', cursor: 'pointer', fontFamily: 'inherit', marginTop: 8, marginBottom: 16 }}
          >
            + Add transaction to explain difference
          </button>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px 28px', borderTop: `1px solid ${C.border}`, flexShrink: 0, display: 'flex', gap: 8 }}>
          <button
            style={{ ...S.btn(unexplainedZero ? C.green : C.surfaceHigh), flex: 2, opacity: saving ? 0.7 : 1 }}
            onClick={() => handleSave(false)}
            disabled={saving || !unexplainedZero}
          >
            {saving ? 'Saving…' : unexplainedZero ? 'Save reconciliation ✓' : `Remaining: ${fmt(unexplained)}`}
          </button>
          {!unexplainedZero && (
            <button
              style={{ ...S.btn(C.surfaceHigh), flex: 1 }}
              onClick={() => handleSave(true)}
              disabled={saving}
            >
              Ignore & save
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
