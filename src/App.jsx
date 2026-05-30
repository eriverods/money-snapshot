import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase, missingConfig } from './lib/supabase'
import ReconcileModal from './ReconcileModal'

// ─── THEME ────────────────────────────────────────────────────────────────────
const C = {
  bg: '#0a0f1a', surface: '#111827', surfaceHigh: '#1e293b',
  border: '#1e293b', text: '#f1f5f9', textMid: '#94a3b8', textLow: '#475569',
  green: '#4ade80', greenBg: '#064e3b', red: '#f87171', redBg: '#450a0a',
  orange: '#f97316', purple: '#a78bfa', blue: '#38bdf8',
}
const S = {
  root: { fontFamily: "'DM Mono','Courier New',monospace", background: C.bg, minHeight: '100vh', color: C.text, paddingBottom: 72 },
  card: { background: C.surface, borderRadius: 14, padding: 14, marginBottom: 12, border: `1px solid ${C.border}` },
  inp: { background: '#0f172a', border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', outline: 'none' },
  sel: { background: '#0f172a', border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  lbl: { fontSize: 10, color: C.textLow, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 4 },
  btn: (bg, light) => ({ background: bg || C.purple, border: 'none', borderRadius: 8, padding: '10px 18px', color: light ? C.textMid : '#0a0f1a', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.3 }),
  secHead: (c) => ({ fontSize: 10, color: c || C.textLow, letterSpacing: 3, textTransform: 'uppercase', margin: '16px 0 8px', fontWeight: 700 }),
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderBottom: `1px solid ${C.border}` },
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function fmt(val) {
  const n = parseFloat(val)
  if (isNaN(n) || val === '' || val == null) return ''
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n)
}

function fmtAmt(val) {
  const n = parseFloat(val) || 0
  const abs = Math.abs(n)
  if (abs >= 10000) return (n < 0 ? '-' : '') + '$' + (abs / 1000).toFixed(1) + 'k'
  return fmt(n)
}

function todayStr() { return new Date().toISOString().slice(0, 10) }

function parseDateLocal(ds) { return new Date(ds + 'T00:00:00') }

function fmtDateLabel(ds) {
  const d = parseDateLocal(ds)
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const diff = Math.round((d - now) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

function fmtMonthDay(ds) {
  return parseDateLocal(ds).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

function expandTx(tx, startDate, endDate) {
  const ws = parseDateLocal(startDate)
  const we = parseDateLocal(endDate)
  const txStart = parseDateLocal(tx.date)
  const txEnd = tx.end_date ? parseDateLocal(tx.end_date) : null
  const out = []
  if (!tx.recurrence || tx.recurrence === 'once') {
    if (txStart >= ws && txStart <= we) out.push(tx.date)
    return out
  }
  let cur = new Date(txStart), safety = 0
  while (cur <= we && safety++ < 500) {
    if (txEnd && cur > txEnd) break
    if (cur >= ws) out.push(cur.toISOString().slice(0, 10))
    if (tx.recurrence === 'weekly')        cur.setDate(cur.getDate() + 7)
    else if (tx.recurrence === 'biweekly') cur.setDate(cur.getDate() + 14)
    else if (tx.recurrence === 'monthly')  cur.setMonth(cur.getMonth() + 1)
    else break
  }
  return out
}

function getOverride(overrides, txId, instanceDate) {
  return overrides.find(o => String(o.transaction_id) === String(txId) && o.instance_date === instanceDate) || null
}

// ─── SMALL COMPONENTS ─────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
      <div style={{ width: 24, height: 24, border: `2px solid ${C.border}`, borderTop: `2px solid ${C.purple}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    </div>
  )
}

function Tag({ color, children }) {
  return <span style={{ fontSize: 9, background: color + '22', color, borderRadius: 4, padding: '2px 6px', letterSpacing: 1, textTransform: 'uppercase', marginLeft: 4, whiteSpace: 'nowrap' }}>{children}</span>
}

function RecurBadge({ r }) {
  if (!r || r === 'once') return null
  return <Tag color={C.blue}>↻ {r}</Tag>
}

// ─── AUTH SCREEN ──────────────────────────────────────────────────────────────
function AuthScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  async function submit() {
    if (!email.trim() || !password) return
    setLoading(true); setError(null); setSuccess(null)
    if (mode === 'signup') {
      const { error: err } = await supabase.auth.signUp({ email: email.trim(), password })
      setLoading(false)
      if (err) setError(err.message)
      else setSuccess('Account created — you can sign in now.')
    } else {
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      setLoading(false)
      if (err) setError(err.message)
    }
  }

  return (
    <div style={{ ...S.root, paddingBottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, minHeight: '100vh' }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: C.purple, letterSpacing: -0.5 }}>Lighthouse Trail</div>
          <div style={{ fontSize: 12, color: C.textLow, marginTop: 4 }}>Cash flow & budget tracker</div>
        </div>
        <div style={S.card}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
            {['signin', 'signup'].map(m => (
              <button key={m} onClick={() => { setMode(m); setError(null); setSuccess(null) }}
                style={{ flex: 1, background: mode === m ? C.purple : C.surfaceHigh, border: 'none', borderRadius: 8, padding: '8px 0', color: mode === m ? '#0a0f1a' : C.textLow, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {m === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>
          <div style={S.lbl}>Email</div>
          <input style={{ ...S.inp, marginBottom: 10 }} type="email" placeholder="your@email.com"
            value={email} onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()} autoFocus />
          <div style={S.lbl}>Password</div>
          <input style={{ ...S.inp, marginBottom: 14 }} type="password" placeholder="••••••••"
            value={password} onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()} />
          {error && <div style={{ fontSize: 11, color: C.red, marginBottom: 10 }}>{error}</div>}
          {success && <div style={{ fontSize: 11, color: C.green, marginBottom: 10 }}>{success}</div>}
          <button style={{ ...S.btn(), width: '100%' }} onClick={submit} disabled={loading}>
            {loading ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── BOOK SETUP ───────────────────────────────────────────────────────────────
function BookSetup({ session, onComplete }) {
  const [bookName, setBookName] = useState('Personal')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function create(migrate) {
    setLoading(true); setError(null)
    try {
      const { data: bookId, error: fnErr } = await supabase.rpc('create_personal_book', {
        p_name: bookName,
        p_migrate: migrate,
      })
      if (fnErr) throw fnErr
      const { data: book, error: fetchErr } = await supabase
        .from('books').select('*').eq('id', bookId).single()
      if (fetchErr) throw fetchErr
      onComplete(book)
    } catch (e) { setError(e.message); setLoading(false) }
  }

  return (
    <div style={{ ...S.root, paddingBottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, minHeight: '100vh' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Welcome to Lighthouse Trail</div>
          <div style={{ fontSize: 12, color: C.textLow, marginTop: 4 }}>Let's set up your money book</div>
        </div>
        <div style={S.card}>
          <div style={S.lbl}>Book name</div>
          <input style={{ ...S.inp, marginBottom: 14 }} value={bookName} onChange={e => setBookName(e.target.value)} />
          {error && <div style={{ fontSize: 11, color: C.red, marginBottom: 10 }}>{error}</div>}
          <div style={{ fontSize: 12, color: C.orange, background: C.orange + '18', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
            Import existing accounts & transactions into this book?
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...S.btn(C.green), flex: 1 }} onClick={() => create(true)} disabled={loading}>
              {loading ? 'Setting up…' : 'Yes, import data'}
            </button>
            <button style={{ ...S.btn(C.surfaceHigh, true), flex: 1 }} onClick={() => create(false)} disabled={loading}>
              Start fresh
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── ADD TRANSACTION MODAL ────────────────────────────────────────────────────
function AddTxModal({ bookId, accounts, onSave, onClose }) {
  const today = todayStr()
  const [form, setForm] = useState({ label: '', amount: '', type: 'expense', account: accounts[0]?.name || '', date: today, recurrence: 'once', end_date: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function set(k, v) { setForm(p => ({ ...p, [k]: v })) }

  async function save() {
    if (!form.label || !form.amount) return
    setSaving(true)
    const { error: e } = await supabase.from('cashflow_transactions').insert({
      label: form.label, amount: parseFloat(form.amount), type: form.type,
      account: form.account, date: form.date, recurrence: form.recurrence,
      end_date: form.end_date || null, book_id: bookId,
    })
    setSaving(false)
    if (e) { setError(e.message); return }
    onSave()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 900, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ background: C.surface, borderRadius: '20px 20px 0 0', padding: '20px 18px 32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Add Transaction</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMid, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={S.lbl}>Type</div>
            <select style={S.sel} value={form.type} onChange={e => set('type', e.target.value)}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </div>
          <div>
            <div style={S.lbl}>Amount</div>
            <input style={S.inp} type="number" step="0.01" placeholder="0.00" value={form.amount} onChange={e => set('amount', e.target.value)} />
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <div style={S.lbl}>Label</div>
          <input style={S.inp} placeholder="e.g. Coffee" value={form.label} onChange={e => set('label', e.target.value)} autoFocus />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={S.lbl}>Account</div>
            <select style={S.sel} value={form.account} onChange={e => set('account', e.target.value)}>
              {accounts.map(a => <option key={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <div style={S.lbl}>Date</div>
            <input style={S.inp} type="date" value={form.date} onChange={e => set('date', e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          <div>
            <div style={S.lbl}>Repeats</div>
            <select style={S.sel} value={form.recurrence} onChange={e => set('recurrence', e.target.value)}>
              <option value="once">Once</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          {form.recurrence !== 'once' && (
            <div>
              <div style={S.lbl}>End date (opt.)</div>
              <input style={S.inp} type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} />
            </div>
          )}
        </div>
        {error && <div style={{ fontSize: 11, color: C.red, marginBottom: 8 }}>{error}</div>}
        <button style={{ ...S.btn(form.type === 'income' ? C.green : C.orange), width: '100%' }} onClick={save} disabled={saving}>
          {saving ? 'Saving…' : `Add ${form.type}`}
        </button>
      </div>
    </div>
  )
}

// ─── OVERVIEW TAB ─────────────────────────────────────────────────────────────
function OverviewTab({ accounts, transactions, overrides, onReconcile }) {
  const today = todayStr()
  const end30 = new Date(); end30.setDate(end30.getDate() + 30)
  const end30str = end30.toISOString().slice(0, 10)

  const totalCash = accounts
    .filter(a => a.type !== 'credit')
    .reduce((s, a) => s + (parseFloat(a.balance) || 0), 0)

  // Next 14 days transactions
  const end14 = new Date(); end14.setDate(end14.getDate() + 14)
  const end14str = end14.toISOString().slice(0, 10)

  const upcoming = useMemo(() => {
    const items = []
    for (const tx of transactions) {
      const dates = expandTx(tx, today, end14str)
      for (const d of dates) {
        const ov = getOverride(overrides, tx.id, d)
        if (ov?.action === 'skipped') continue
        items.push({ tx, date: d, override: ov })
      }
    }
    return items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 20)
  }, [transactions, overrides, today, end14str])

  const inc30 = useMemo(() => {
    let s = 0
    for (const tx of transactions.filter(t => t.type === 'income')) {
      expandTx(tx, today, end30str).forEach(() => { s += parseFloat(tx.amount) || 0 })
    }
    return s
  }, [transactions, today, end30str])

  const exp30 = useMemo(() => {
    let s = 0
    for (const tx of transactions.filter(t => t.type !== 'income')) {
      expandTx(tx, today, end30str).forEach(() => { s += parseFloat(tx.amount) || 0 })
    }
    return s
  }, [transactions, today, end30str])

  const net30 = totalCash + inc30 - exp30

  return (
    <div>
      {/* Net position */}
      <div style={{ background: net30 >= 0 ? C.greenBg : C.redBg, borderRadius: 14, padding: '18px 16px', marginBottom: 12, border: `1px solid ${net30 >= 0 ? C.green : C.red}` }}>
        <div style={{ fontSize: 10, color: net30 >= 0 ? C.green : C.red, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>Net Position (30d)</div>
        <div style={{ fontSize: 32, fontWeight: 700, color: net30 >= 0 ? C.green : C.red, letterSpacing: -1 }}>{fmtAmt(net30)}</div>
        <div style={{ fontSize: 11, color: net30 >= 0 ? C.green : C.red, marginTop: 2 }}>{net30 >= 0 ? 'Looking covered' : 'Shortfall detected'}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div style={S.card}>
          <div style={S.lbl}>Cash on hand</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.green }}>{fmtAmt(totalCash) || '--'}</div>
        </div>
        <div style={S.card}>
          <div style={S.lbl}>Income (30d)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.green }}>{fmtAmt(inc30) || '--'}</div>
        </div>
        <div style={S.card}>
          <div style={S.lbl}>Bills (30d)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.red }}>{fmtAmt(exp30) || '--'}</div>
        </div>
        <div style={{ ...S.card, cursor: 'pointer' }} onClick={() => accounts[0] && onReconcile(accounts[0])}>
          <div style={S.lbl}>Reconcile</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.purple }}>→ Update balance</div>
        </div>
      </div>

      {/* Accounts quick view */}
      <div style={S.card}>
        <div style={{ ...S.lbl, marginBottom: 10 }}>Accounts</div>
        {accounts.map((a, i) => (
          <div key={a.id} onClick={() => onReconcile(a)} style={{ ...S.row, cursor: 'pointer', borderBottom: i < accounts.length - 1 ? `1px solid ${C.border}` : 'none' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{a.name}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: (parseFloat(a.balance) || 0) >= 0 ? C.green : C.red }}>
              {fmt(a.balance) || '--'}
            </div>
          </div>
        ))}
      </div>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div style={S.card}>
          <div style={{ ...S.lbl, marginBottom: 10 }}>Next 14 days</div>
          {upcoming.map((item, i) => {
            const ov = item.override
            const isIncome = item.tx.type === 'income'
            const amt = ov?.action === 'modified' ? ov.modified_amount : item.tx.amount
            const state = ov?.action || 'projected'
            return (
              <div key={`${item.tx.id}:${item.date}`} style={{ ...S.row, borderBottom: i < upcoming.length - 1 ? `1px solid ${C.border}` : 'none', opacity: state === 'skipped' ? 0.4 : 1 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, fontStyle: state === 'projected' ? 'italic' : 'normal', color: isIncome ? C.green : C.text }}>
                      {item.tx.label}
                    </span>
                    {state === 'approved' && <span style={{ fontSize: 11, color: C.green }}>✓</span>}
                    {state === 'modified' && <span style={{ fontSize: 11, color: C.orange }}>✎</span>}
                    {state === 'skipped' && <span style={{ fontSize: 11, color: C.textLow }}>⊘</span>}
                    <RecurBadge r={item.tx.recurrence} />
                  </div>
                  <div style={{ fontSize: 10, color: C.textLow, marginTop: 1 }}>{fmtDateLabel(item.date)} · {item.tx.account}</div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: isIncome ? C.green : C.red }}>
                  {isIncome ? '+' : '-'}{fmt(amt)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── AGENDA TAB ───────────────────────────────────────────────────────────────
function AgendaTab({ accounts, transactions, overrides, onOverrideChange }) {
  const today = todayStr()
  const pastStart = new Date(); pastStart.setDate(pastStart.getDate() - 14)
  const futureEnd = new Date(); futureEnd.setDate(futureEnd.getDate() + 60)
  const startStr = pastStart.toISOString().slice(0, 10)
  const endStr = futureEnd.toISOString().slice(0, 10)

  const [filterAccount, setFilterAccount] = useState('')
  const [filterType, setFilterType] = useState('')

  const allInstances = useMemo(() => {
    const items = []
    for (const tx of transactions) {
      if (filterAccount && tx.account !== filterAccount) continue
      if (filterType && tx.type !== filterType) continue
      const dates = expandTx(tx, startStr, endStr)
      for (const d of dates) {
        const ov = getOverride(overrides, tx.id, d)
        items.push({ tx, date: d, override: ov, state: ov?.action || 'projected' })
      }
    }
    return items.sort((a, b) => a.date.localeCompare(b.date))
  }, [transactions, overrides, startStr, endStr, filterAccount, filterType])

  // Compute running balance starting from today's total cash
  const todayBalance = accounts
    .filter(a => a.type !== 'credit')
    .reduce((s, a) => s + (parseFloat(a.balance) || 0), 0)

  const instancesWithBalance = useMemo(() => {
    let running = todayBalance
    // First, adjust running back to start: subtract projected future, add past projected
    // Simpler: just annotate each with a projected running balance from today forward
    let bal = todayBalance
    const todayIdx = allInstances.findIndex(i => i.date >= today)

    // compute past items that reduce today's balance (we can't go back, so just show balance from today forward)
    return allInstances.map((inst, idx) => {
      const amt = inst.override?.action === 'modified'
        ? (parseFloat(inst.override.modified_amount) || 0)
        : (parseFloat(inst.tx.amount) || 0)
      const signed = inst.tx.type === 'income' ? amt : -amt
      let balAfter = null
      if (inst.date >= today && inst.state !== 'skipped') {
        bal += signed
        balAfter = bal
      }
      return { ...inst, balAfter }
    })
  }, [allInstances, todayBalance, today])

  // Group by date
  const byDate = useMemo(() => {
    const map = new Map()
    for (const inst of instancesWithBalance) {
      if (!map.has(inst.date)) map.set(inst.date, [])
      map.get(inst.date).push(inst)
    }
    return Array.from(map.entries())
  }, [instancesWithBalance])

  async function quickApprove(tx, date, currentState) {
    const newAction = currentState === 'approved' ? null : 'approved'
    const ov = getOverride(overrides, tx.id, date)
    if (newAction === null && ov) {
      await supabase.from('cashflow_overrides').delete().eq('id', ov.id)
    } else {
      const record = { transaction_id: tx.id, instance_date: date, action: newAction }
      if (ov) {
        await supabase.from('cashflow_overrides').update(record).eq('id', ov.id)
      } else {
        await supabase.from('cashflow_overrides').insert(record)
      }
    }
    onOverrideChange()
  }

  async function quickSkip(tx, date, currentState) {
    const newAction = currentState === 'skipped' ? null : 'skipped'
    const ov = getOverride(overrides, tx.id, date)
    if (newAction === null && ov) {
      await supabase.from('cashflow_overrides').delete().eq('id', ov.id)
    } else {
      const record = { transaction_id: tx.id, instance_date: date, action: newAction }
      if (ov) {
        await supabase.from('cashflow_overrides').update(record).eq('id', ov.id)
      } else {
        await supabase.from('cashflow_overrides').insert(record)
      }
    }
    onOverrideChange()
  }

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <select style={{ ...S.sel, flex: 1 }} value={filterAccount} onChange={e => setFilterAccount(e.target.value)}>
          <option value="">All accounts</option>
          {accounts.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
        </select>
        <select style={{ ...S.sel, flex: 1 }} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All types</option>
          <option value="income">Income</option>
          <option value="expense">Expenses</option>
        </select>
      </div>

      {allInstances.length === 0 && (
        <div style={{ textAlign: 'center', color: C.textLow, padding: '40px 0', fontSize: 13 }}>
          No transactions in this window
        </div>
      )}

      {byDate.map(([date, insts]) => {
        const isToday = date === today
        const isPast = date < today
        return (
          <div key={date}>
            {/* Date header */}
            <div style={{ fontSize: 10, color: isToday ? C.purple : isPast ? C.textLow : C.textMid, textTransform: 'uppercase', letterSpacing: 2, padding: '12px 0 5px', fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{isToday ? '● TODAY' : fmtDateLabel(date)}</span>
              {insts[insts.length - 1]?.balAfter != null && (
                <span style={{ color: insts[insts.length - 1].balAfter >= 0 ? C.green : C.red, fontSize: 11, fontWeight: 700 }}>
                  {fmtAmt(insts[insts.length - 1].balAfter)}
                </span>
              )}
            </div>

            {/* Instances */}
            {insts.map((inst, i) => {
              const isIncome = inst.tx.type === 'income'
              const isApproved = inst.state === 'approved'
              const isSkipped = inst.state === 'skipped'
              const isModified = inst.state === 'modified'
              const amt = isModified ? (inst.override?.modified_amount ?? inst.tx.amount) : inst.tx.amount
              return (
                <div key={`${inst.tx.id}:${inst.date}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: i < insts.length - 1 ? `1px solid ${C.border}` : 'none', opacity: isSkipped ? 0.4 : 1 }}>
                  {/* Approve toggle */}
                  <button
                    onClick={() => quickApprove(inst.tx, inst.date, inst.state)}
                    style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${isApproved || isModified ? C.green : isPast ? C.orange + '80' : C.border}`, background: isApproved || isModified ? C.green : 'transparent', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}
                  >
                    {(isApproved || isModified) && <span style={{ color: '#0a0f1a', fontWeight: 900 }}>✓</span>}
                  </button>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: isApproved ? 700 : 500, fontStyle: inst.state === 'projected' ? 'italic' : 'normal', color: isSkipped ? C.textLow : C.text, textDecoration: isSkipped ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {inst.tx.label}
                    </div>
                    <div style={{ fontSize: 10, color: C.textLow, marginTop: 1 }}>
                      {inst.tx.account}
                      {inst.tx.recurrence !== 'once' && <span style={{ color: C.blue + 'aa' }}> · ↻ {inst.tx.recurrence}</span>}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: isIncome ? C.green : C.red }}>
                      {isIncome ? '+' : '-'}{fmt(amt)}
                    </div>
                  </div>

                  {/* Skip */}
                  <button
                    onClick={() => quickSkip(inst.tx, inst.date, inst.state)}
                    style={{ background: 'none', border: 'none', color: isSkipped ? C.orange : C.textLow, cursor: 'pointer', fontSize: 13, padding: '0 2px', flexShrink: 0 }}
                    title={isSkipped ? 'Unskip' : 'Skip'}
                  >
                    {isSkipped ? '↩' : '⊘'}
                  </button>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ─── CALENDAR TAB ─────────────────────────────────────────────────────────────
function CalendarTab({ accounts, transactions, overrides }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())

  const today = todayStr()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const monthEnd = lastDay.toISOString().slice(0, 10)

  const totalCash = accounts
    .filter(a => a.type !== 'credit')
    .reduce((s, a) => s + (parseFloat(a.balance) || 0), 0)

  // Build daily net change map
  const dailyNet = useMemo(() => {
    const map = {}
    for (const tx of transactions) {
      const dates = expandTx(tx, monthStart, monthEnd)
      for (const d of dates) {
        const ov = getOverride(overrides, tx.id, d)
        if (ov?.action === 'skipped') continue
        const amt = ov?.action === 'modified' ? (parseFloat(ov.modified_amount) || 0) : (parseFloat(tx.amount) || 0)
        const signed = tx.type === 'income' ? amt : -amt
        map[d] = (map[d] || 0) + signed
      }
    }
    return map
  }, [transactions, overrides, monthStart, monthEnd])

  // Compute running balance per day starting from today
  const dailyBalance = useMemo(() => {
    const result = {}
    let bal = totalCash
    // Fill forward from today through end of month
    const end = new Date(year, month + 1, 0)
    const start = new Date(Math.max(new Date(today + 'T00:00:00'), new Date(year, month, 1)))
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const ds = d.toISOString().slice(0, 10)
      bal += (dailyNet[ds] || 0)
      result[ds] = bal
    }
    return result
  }, [dailyNet, totalCash, today, year, month])

  const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
  const startPad = firstDay.getDay()
  const cells = []
  for (let i = 0; i < startPad; i++) cells.push(null)
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']

  return (
    <div>
      {/* Month nav */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <button onClick={prevMonth} style={{ ...S.btn(C.surfaceHigh, true), padding: '8px 14px' }}>‹</button>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{monthNames[month]} {year}</div>
        <button onClick={nextMonth} style={{ ...S.btn(C.surfaceHigh, true), padding: '8px 14px' }}>›</button>
      </div>

      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
        {DAYS.map(d => <div key={d} style={{ textAlign: 'center', fontSize: 9, color: C.textLow, letterSpacing: 1, padding: '4px 0' }}>{d}</div>)}
      </div>

      {/* Calendar grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} />
          const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const isToday = ds === today
          const net = dailyNet[ds] || 0
          const bal = dailyBalance[ds]
          const isPast = ds < today
          return (
            <div key={i} style={{ background: isToday ? C.surfaceHigh : C.surface, borderRadius: 8, padding: '6px 4px', border: isToday ? `1px solid ${C.purple}` : `1px solid ${C.border}`, minHeight: 54, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontSize: 11, fontWeight: isToday ? 700 : 400, color: isToday ? C.purple : isPast ? C.textLow : C.textMid }}>{day}</div>
              {net !== 0 && (
                <div style={{ fontSize: 9, fontWeight: 700, color: net > 0 ? C.green : C.red, marginTop: 2, lineHeight: 1 }}>
                  {net > 0 ? '+' : ''}{fmtAmt(net)}
                </div>
              )}
              {bal != null && (
                <div style={{ fontSize: 9, color: bal >= 0 ? C.green + 'aa' : C.red + 'aa', marginTop: 2 }}>
                  {fmtAmt(bal)}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginTop: 12, justifyContent: 'center' }}>
        <div style={{ fontSize: 9, color: C.textLow }}>
          <span style={{ color: C.green }}>+$X</span> = day net · balance below
        </div>
      </div>
    </div>
  )
}

// ─── ACCOUNTS TAB ─────────────────────────────────────────────────────────────
function AccountsTab({ accounts, onReconcile, onRefresh }) {
  const [editId, setEditId] = useState(null)
  const [editName, setEditName] = useState('')
  const [saving, setSaving] = useState(false)

  async function saveEdit(id) {
    setSaving(true)
    await supabase.from('cashflow_accounts').update({ name: editName }).eq('id', id)
    setSaving(false)
    setEditId(null)
    onRefresh()
  }

  return (
    <div>
      <div style={{ fontSize: 11, color: C.textLow, marginBottom: 14 }}>
        Tap a balance to reconcile it against your actual bank balance.
      </div>
      {accounts.map(a => {
        const bal = parseFloat(a.balance) || 0
        const isNeg = bal < 0
        return (
          <div key={a.id} style={{ ...S.card, borderLeft: `3px solid ${isNeg ? C.red : C.green}` }}>
            {editId === a.id ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...S.inp, flex: 1 }} value={editName} onChange={e => setEditName(e.target.value)} autoFocus />
                <button style={S.btn(C.green)} onClick={() => saveEdit(a.id)} disabled={saving}>Save</button>
                <button style={S.btn(C.surfaceHigh, true)} onClick={() => setEditId(null)}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: isNeg ? C.red : C.green }}>{a.name}</div>
                <button onClick={() => { setEditId(a.id); setEditName(a.name) }} style={{ background: 'none', border: 'none', color: C.textLow, fontSize: 11, cursor: 'pointer' }}>rename</button>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              <div>
                <div style={S.lbl}>Balance</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: isNeg ? C.red : C.green }}>{fmt(a.balance) || '--'}</div>
              </div>
              <button style={S.btn(C.purple)} onClick={() => onReconcile(a)}>
                Reconcile
              </button>
            </div>
            {a.baseline_date && (
              <div style={{ fontSize: 10, color: C.textLow, marginTop: 6 }}>
                Last confirmed: {fmtMonthDay(a.baseline_date)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── TRANSACTIONS MANAGEMENT TAB ──────────────────────────────────────────────
function TransactionsTab({ transactions, bookId, onRefresh }) {
  const [showAdd, setShowAdd] = useState(false)
  const [accounts, setAccounts] = useState([])
  const [filter, setFilter] = useState('')

  useEffect(() => {
    supabase.from('cashflow_accounts').select('id,name').eq('book_id', bookId)
      .then(({ data }) => setAccounts(data || []))
  }, [bookId])

  async function deleteTx(id) {
    if (!confirm('Delete this transaction and all its overrides?')) return
    await supabase.from('cashflow_overrides').delete().eq('transaction_id', id)
    await supabase.from('cashflow_transactions').delete().eq('id', id)
    onRefresh()
  }

  const filtered = filter
    ? transactions.filter(t => t.label.toLowerCase().includes(filter.toLowerCase()) || t.account?.toLowerCase().includes(filter.toLowerCase()))
    : transactions

  const sorted = [...filtered].sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          style={{ ...S.inp, flex: 1 }}
          placeholder="Search transactions…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <button style={S.btn()} onClick={() => setShowAdd(true)}>+ Add</button>
      </div>

      {showAdd && (
        <AddTxModal
          bookId={bookId}
          accounts={accounts}
          onSave={() => { setShowAdd(false); onRefresh() }}
          onClose={() => setShowAdd(false)}
        />
      )}

      {sorted.length === 0 && (
        <div style={{ textAlign: 'center', color: C.textLow, padding: '30px 0', fontSize: 13 }}>
          No transactions yet
        </div>
      )}

      {sorted.map((tx, i) => (
        <div key={tx.id} style={{ ...S.row, borderBottom: i < sorted.length - 1 ? `1px solid ${C.border}` : 'none' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{tx.label}</span>
              <RecurBadge r={tx.recurrence} />
              {tx.type === 'income'
                ? <span style={{ fontSize: 9, background: C.green + '22', color: C.green, borderRadius: 4, padding: '2px 5px', letterSpacing: 1 }}>INCOME</span>
                : <span style={{ fontSize: 9, background: C.red + '22', color: C.red, borderRadius: 4, padding: '2px 5px', letterSpacing: 1 }}>EXPENSE</span>
              }
            </div>
            <div style={{ fontSize: 10, color: C.textLow }}>
              {tx.account} · {tx.recurrence === 'once' ? fmtMonthDay(tx.date) : `from ${fmtMonthDay(tx.date)}`}
              {tx.end_date ? ` → ${fmtMonthDay(tx.end_date)}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: tx.type === 'income' ? C.green : C.red }}>
              {tx.type === 'income' ? '+' : '-'}{fmt(tx.amount)}
            </span>
            <button onClick={() => deleteTx(tx.id)} style={{ background: 'none', border: 'none', color: C.red, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── CHECK-IN BANNER ──────────────────────────────────────────────────────────
function CheckInBanner({ onReconcile, onQuickAdd, onDismiss }) {
  return (
    <div style={{ background: C.orange + '18', border: `1px solid ${C.orange}44`, borderRadius: 12, padding: '12px 14px', marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.orange, marginBottom: 8 }}>Daily check-in</div>
      <div style={{ fontSize: 11, color: C.textMid, marginBottom: 10 }}>How's the money looking today?</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button style={{ ...S.btn(C.orange), fontSize: 11, padding: '7px 12px' }} onClick={onReconcile}>
          Reconcile balance
        </button>
        <button style={{ ...S.btn(C.surfaceHigh, true), fontSize: 11, padding: '7px 12px' }} onClick={onQuickAdd}>
          Add transaction
        </button>
        <button style={{ ...S.btn(C.surfaceHigh, true), fontSize: 11, padding: '7px 12px' }} onClick={onDismiss}>
          Nothing new today
        </button>
      </div>
    </div>
  )
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
function MainApp({ session, book, allBooks, onSwitchBook, onSignOut }) {
  const [accounts, setAccounts] = useState([])
  const [transactions, setTransactions] = useState([])
  const [overrides, setOverrides] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [reconcileAccount, setReconcileAccount] = useState(null)
  const [showAddTx, setShowAddTx] = useState(false)
  const [showCheckin, setShowCheckin] = useState(false)
  const [showBookPicker, setShowBookPicker] = useState(false)

  const today = todayStr()

  useEffect(() => {
    const key = 'lt_checkin_' + today
    if (!localStorage.getItem(key)) setShowCheckin(true)
  }, [today])

  const loadData = useCallback(async () => {
    const [{ data: accts }, { data: txs }] = await Promise.all([
      supabase.from('cashflow_accounts').select('*').eq('book_id', book.id).order('name'),
      supabase.from('cashflow_transactions').select('*').eq('book_id', book.id).order('date'),
    ])
    const txIds = (txs || []).map(t => t.id)
    let ovs = []
    if (txIds.length > 0) {
      const { data } = await supabase.from('cashflow_overrides').select('*').in('transaction_id', txIds)
      ovs = data || []
    }
    setAccounts(accts || [])
    setTransactions(txs || [])
    setOverrides(ovs)
    setLoading(false)
  }, [book.id])

  useEffect(() => { loadData() }, [loadData])

  function dismissCheckin() {
    localStorage.setItem('lt_checkin_' + today, '1')
    setShowCheckin(false)
  }

  async function handleReconcileSave({ newBalance, newBaselineDate, overrides: ovToWrite, newTransactions: newTxs }) {
    const acct = reconcileAccount

    // Upsert overrides
    for (const ov of ovToWrite) {
      const existing = overrides.find(o => String(o.transaction_id) === String(ov.transaction_id) && o.instance_date === ov.instance_date)
      if (existing) {
        await supabase.from('cashflow_overrides').update({ action: ov.action, modified_amount: ov.modified_amount }).eq('id', existing.id)
      } else {
        await supabase.from('cashflow_overrides').insert(ov)
      }
    }

    // Create new transactions
    for (const nt of newTxs) {
      await supabase.from('cashflow_transactions').insert({
        label: nt.label, amount: parseFloat(nt.amount), type: nt.type,
        account: acct.name, date: newBaselineDate, recurrence: 'once', book_id: book.id,
      })
    }

    // Update account balance and baseline_date
    await supabase.from('cashflow_accounts').update({ balance: newBalance, baseline_date: newBaselineDate }).eq('id', acct.id)

    setReconcileAccount(null)
    dismissCheckin()
    await loadData()
  }

  const tabs = [
    { id: 'overview', label: 'Home', icon: '⌂' },
    { id: 'agenda', label: 'Agenda', icon: '≡' },
    { id: 'calendar', label: 'Calendar', icon: '▦' },
    { id: 'accounts', label: 'Accounts', icon: '◎' },
    { id: 'transactions', label: 'Manage', icon: '✦' },
  ]

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#0f172a,#1e1b4b)', padding: '16px 16px 12px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 10, color: C.textLow, letterSpacing: 3, textTransform: 'uppercase' }}>
              {new Date().toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, letterSpacing: -0.3 }}>Lighthouse Trail</div>
            <button
              onClick={() => allBooks.length > 1 && setShowBookPicker(true)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: allBooks.length > 1 ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}
            >
              <span style={{ fontSize: 10, color: C.textLow }}>{book.name}</span>
              {allBooks.length > 1 && <span style={{ fontSize: 9, color: C.purple }}>▾</span>}
            </button>
          </div>
          <button onClick={onSignOut} style={{ background: 'none', border: 'none', color: C.textLow, fontSize: 11, cursor: 'pointer', padding: '4px 8px' }}>
            Sign out
          </button>
        </div>
      </div>

      {/* Book picker */}
      {showBookPicker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200 }} onClick={() => setShowBookPicker(false)}>
          <div style={{ position: 'absolute', top: 70, left: 16, right: 16, background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 10, color: C.textLow, letterSpacing: 2, textTransform: 'uppercase', padding: '12px 14px 6px' }}>Switch book</div>
            {allBooks.map(b => (
              <button key={b.id} onClick={() => { onSwitchBook(b); setShowBookPicker(false) }}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', background: 'none', border: 'none', borderTop: `1px solid ${C.border}`, padding: '13px 14px', color: C.text, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontWeight: b.id === book.id ? 700 : 400 }}>{b.name}</span>
                {b.id === book.id && <span style={{ fontSize: 12, color: C.purple }}>✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      <div style={{ padding: '14px 14px 0' }}>
        {showCheckin && (
          <CheckInBanner
            onReconcile={() => { setShowCheckin(false); accounts[0] && setReconcileAccount(accounts[0]) }}
            onQuickAdd={() => { setShowCheckin(false); setShowAddTx(true) }}
            onDismiss={dismissCheckin}
          />
        )}

        {loading ? <Spinner /> : (
          <>
            {activeTab === 'overview' && (
              <OverviewTab accounts={accounts} transactions={transactions} overrides={overrides} onReconcile={setReconcileAccount} />
            )}
            {activeTab === 'agenda' && (
              <AgendaTab accounts={accounts} transactions={transactions} overrides={overrides} onOverrideChange={loadData} />
            )}
            {activeTab === 'calendar' && (
              <CalendarTab accounts={accounts} transactions={transactions} overrides={overrides} />
            )}
            {activeTab === 'accounts' && (
              <AccountsTab accounts={accounts} onReconcile={setReconcileAccount} onRefresh={loadData} />
            )}
            {activeTab === 'transactions' && (
              <TransactionsTab transactions={transactions} bookId={book.id} onRefresh={loadData} />
            )}
          </>
        )}
      </div>

      {/* Bottom tab bar */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: C.surface, borderTop: `1px solid ${C.border}`, display: 'flex', zIndex: 100, paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ flex: 1, background: 'none', border: 'none', padding: '10px 0 8px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>{t.icon}</span>
            <span style={{ fontSize: 9, color: activeTab === t.id ? C.purple : C.textLow, fontWeight: activeTab === t.id ? 700 : 400, letterSpacing: 0.5 }}>{t.label}</span>
            {activeTab === t.id && <div style={{ width: 16, height: 2, background: C.purple, borderRadius: 1 }} />}
          </button>
        ))}
      </div>

      {/* Modals */}
      {reconcileAccount && (
        <ReconcileModal
          account={reconcileAccount}
          transactions={transactions}
          overrides={overrides}
          onSave={handleReconcileSave}
          onClose={() => setReconcileAccount(null)}
        />
      )}
      {showAddTx && (
        <AddTxModal
          bookId={book.id}
          accounts={accounts}
          onSave={() => { setShowAddTx(false); loadData() }}
          onClose={() => setShowAddTx(false)}
        />
      )}
    </div>
  )
}

// ─── CONFIG ERROR SCREEN ──────────────────────────────────────────────────────
function ConfigError() {
  return (
    <div style={{ ...S.root, paddingBottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, minHeight: '100vh' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: C.orange, marginBottom: 12 }}>Missing configuration</div>
        <div style={{ ...S.card, borderLeft: `3px solid ${C.orange}` }}>
          <p style={{ fontSize: 13, color: C.textMid, lineHeight: 1.7, margin: '0 0 14px' }}>
            The <code style={{ color: C.orange }}>VITE_SUPABASE_ANON_KEY</code> environment variable is not set.
          </p>
          <p style={{ fontSize: 12, color: C.textLow, lineHeight: 1.7, margin: 0 }}>
            In Netlify → Site configuration → Environment variables, add:<br /><br />
            <code style={{ color: C.text, fontSize: 11 }}>VITE_SUPABASE_ANON_KEY</code><br />
            <span style={{ fontSize: 11 }}>Value: your anon key from Supabase → Settings → API</span><br /><br />
            Then redeploy.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  // Hooks must always run — conditional returns come AFTER
  const [session, setSession] = useState(undefined)
  const [book, setBook] = useState(null)
  const [allBooks, setAllBooks] = useState([])
  const [checkingBook, setCheckingBook] = useState(false)

  useEffect(() => {
    if (missingConfig) return
    supabase.auth.getSession()
      .then(({ data: { session: s } }) => setSession(s ?? null))
      .catch(() => setSession(null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null)
      if (!s) setBook(null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (missingConfig || !session) return
    setCheckingBook(true)
    supabase.from('books').select('*').eq('owner_user_id', session.user.id).order('created_at')
      .then(({ data }) => {
        const books = data || []
        setAllBooks(books)
        if (books.length > 0) setBook(books[0])
        setCheckingBook(false)
      })
  }, [session])

  async function signOut() {
    if (missingConfig) return
    await supabase.auth.signOut()
    setBook(null)
  }

  // Conditional renders after all hooks
  if (missingConfig) return <ConfigError />

  if (session === undefined || checkingBook) {
    return (
      <div style={{ ...S.root, paddingBottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: 16 }}>
        <Spinner />
        <div style={{ fontSize: 12, color: C.textLow }}>Loading Lighthouse Trail…</div>
      </div>
    )
  }

  if (!session) return <AuthScreen />
  if (!book) return <BookSetup session={session} onComplete={b => { setAllBooks(prev => [...prev, b]); setBook(b) }} />

  return <MainApp session={session} book={book} allBooks={allBooks} onSwitchBook={setBook} onSignOut={signOut} />
}
