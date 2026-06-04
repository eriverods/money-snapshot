import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase, missingConfig } from './lib/supabase'
import ReconcileModal from './ReconcileModal'
import CyclesTab from './CyclesTab'
import GoalsTab from './GoalsTab'

// ─── THEME ────────────────────────────────────────────────────────────────────
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
  root: { fontFamily: "'Lato', sans-serif", background: C.bg, minHeight: '100vh', color: C.text, paddingBottom: 'calc(80px + env(safe-area-inset-bottom))' },
  card: { background: C.surface, borderRadius: 14, padding: 14, marginBottom: 12, border: `1px solid ${C.border}` },
  inp: { background: 'var(--c-input-bg)', border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', outline: 'none' },
  sel: { background: 'var(--c-input-bg)', border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', color: C.text, fontSize: 14, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  lbl: { fontSize: 10, color: C.textLow, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 4 },
  btn: (bg, light) => ({ background: bg || C.purple, border: 'none', borderRadius: 8, padding: '10px 18px', color: light ? C.textMid : 'var(--c-btn-text)', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.3 }),
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

// ─── CATEGORIES ───────────────────────────────────────────────────────────────
const DEFAULT_CATEGORIES = [
  'Income','Housing','Transport','Groceries','Dining','Health',
  'Subscriptions','Personal Care','Clothing','Entertainment',
  'Savings Transfer','Debt Payment','Kids','Pets','Gifts','Other',
]

async function seedDefaultCategories(bookId) {
  const rows = DEFAULT_CATEGORIES.map((name, i) => ({ book_id: bookId, name, sort_order: i, is_default: true }))
  await supabase.from('categories').insert(rows)
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
  return <span style={{ fontSize: 9, background: `color-mix(in srgb, ${color} 13%, transparent)`, color, borderRadius: 4, padding: '2px 6px', letterSpacing: 1, textTransform: 'uppercase', marginLeft: 4, whiteSpace: 'nowrap' }}>{children}</span>
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
                style={{ flex: 1, background: mode === m ? C.purple : C.surfaceHigh, border: 'none', borderRadius: 8, padding: '8px 0', color: mode === m ? 'var(--c-btn-text)' : C.textLow, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
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
          <div style={{ fontSize: 12, color: C.orange, background: 'var(--c-warn-bg)', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
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
function AddTxModal({ bookId, accounts, categories, onSave, onClose, defaultType, defaultRecurrence }) {
  const today = todayStr()
  const [form, setForm] = useState({
    label: '', amount: '', type: defaultType || 'expense',
    account: accounts[0]?.name || '', date: today,
    recurrence: defaultRecurrence || 'once', end_date: '', category: '',
  })
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
      category: form.category || null,
    })
    setSaving(false)
    if (e) { setError(e.message); return }
    onSave()
  }

  const catOptions = categories?.length ? categories : DEFAULT_CATEGORIES.map(n => ({ name: n }))

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 900, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ background: C.surface, borderRadius: '20px 20px 0 0', padding: '20px 18px 32px', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{defaultRecurrence && defaultRecurrence !== 'once' ? 'Add Recurring Bill' : 'Add Transaction'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMid, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={S.lbl}>Type</div>
            <select style={S.sel} value={form.type} onChange={e => set('type', e.target.value)}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="transfer">Transfer</option>
            </select>
          </div>
          <div>
            <div style={S.lbl}>Amount</div>
            <input style={S.inp} type="number" step="0.01" placeholder="0.00" value={form.amount} onChange={e => set('amount', e.target.value)} />
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <div style={S.lbl}>Label</div>
          <input style={S.inp} placeholder="e.g. Rent" value={form.label} onChange={e => set('label', e.target.value)} autoFocus />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={S.lbl}>Account</div>
            <select style={S.sel} value={form.account} onChange={e => set('account', e.target.value)}>
              {accounts.map(a => <option key={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <div style={S.lbl}>Category</div>
            <select style={S.sel} value={form.category} onChange={e => set('category', e.target.value)}>
              <option value="">None</option>
              {catOptions.map((c, i) => <option key={i} value={c.name}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={S.lbl}>Date</div>
            <input style={S.inp} type="date" value={form.date} onChange={e => set('date', e.target.value)} />
          </div>
          <div>
            <div style={S.lbl}>Repeats</div>
            <select style={S.sel} value={form.recurrence} onChange={e => set('recurrence', e.target.value)}>
              <option value="once">Once</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
        </div>
        {form.recurrence !== 'once' && (
          <div style={{ marginBottom: 10 }}>
            <div style={S.lbl}>End date (opt.)</div>
            <input style={S.inp} type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} />
          </div>
        )}
        {error && <div style={{ fontSize: 11, color: C.red, marginBottom: 8 }}>{error}</div>}
        <button style={{ ...S.btn(form.type === 'income' ? C.green : C.orange), width: '100%', marginTop: 6 }} onClick={save} disabled={saving}>
          {saving ? 'Saving…' : form.type === 'income' ? 'Add Income' : form.type === 'transfer' ? 'Add Transfer' : 'Add Expense'}
        </button>
      </div>
    </div>
  )
}

// ─── EDIT TRANSACTION SHEET ───────────────────────────────────────────────────
function EditTxSheet({ tx, date, override, categories, onClose, onRefresh }) {
  const isRecurring = tx.recurrence && tx.recurrence !== 'once'
  const isSkipped = override?.action === 'skipped'
  const isModified = override?.action === 'modified'
  const currentAmt = isModified ? (parseFloat(override.modified_amount) || 0) : (parseFloat(tx.amount) || 0)
  const [editAmt, setEditAmt] = useState(String(currentAmt.toFixed(2)))
  const [showDelete, setShowDelete] = useState(false)
  const [saving, setSaving] = useState(false)

  async function saveOnce() {
    const parsed = parseFloat(editAmt)
    if (isNaN(parsed) || parsed <= 0) return
    setSaving(true)
    const rec = { transaction_id: tx.id, instance_date: date, action: 'modified', modified_amount: parsed }
    if (override) await supabase.from('cashflow_overrides').update(rec).eq('id', override.id)
    else await supabase.from('cashflow_overrides').insert(rec)
    setSaving(false)
    onRefresh(); onClose()
  }

  async function saveAllFuture() {
    const parsed = parseFloat(editAmt)
    if (isNaN(parsed) || parsed <= 0) return
    setSaving(true)
    await supabase.from('cashflow_transactions').update({ amount: parsed }).eq('id', tx.id)
    setSaving(false)
    onRefresh(); onClose()
  }

  async function toggleSkip() {
    setSaving(true)
    if (isSkipped && override) {
      await supabase.from('cashflow_overrides').delete().eq('id', override.id)
    } else {
      const rec = { transaction_id: tx.id, instance_date: date, action: 'skipped' }
      if (override) await supabase.from('cashflow_overrides').update(rec).eq('id', override.id)
      else await supabase.from('cashflow_overrides').insert(rec)
    }
    setSaving(false)
    onRefresh(); onClose()
  }

  async function deleteTx() {
    setSaving(true)
    await supabase.from('cashflow_overrides').delete().eq('transaction_id', tx.id)
    await supabase.from('cashflow_transactions').delete().eq('id', tx.id)
    setSaving(false)
    onRefresh(); onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 1000, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }} onClick={onClose}>
      <div style={{ background: C.surface, borderRadius: '20px 20px 0 0', padding: '20px 18px 36px', maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{tx.label}</div>
            <div style={{ fontSize: 11, color: C.textLow, marginTop: 2 }}>
              {fmtDateLabel(date)} · {tx.account}{tx.category ? ` · ${tx.category}` : ''}
              {isRecurring && <span style={{ color: 'var(--c-info-67)' }}> · ↻ {tx.recurrence}</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMid, fontSize: 22, cursor: 'pointer', flexShrink: 0 }}>×</button>
        </div>

        <div style={{ fontSize: 10, color: C.textLow, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 6 }}>Edit amount</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          <input
            style={{ ...S.inp, flex: 1, fontSize: 22, fontWeight: 700, textAlign: 'center' }}
            type="number" step="0.01"
            value={editAmt}
            onChange={e => setEditAmt(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <button style={{ ...S.btn(), flex: 1 }} onClick={saveOnce} disabled={saving}>This time</button>
          {isRecurring && (
            <button style={{ ...S.btn(C.orange), flex: 1 }} onClick={saveAllFuture} disabled={saving}>All future</button>
          )}
        </div>

        <button
          onClick={toggleSkip} disabled={saving}
          style={{ width: '100%', background: isSkipped ? 'rgba(243,193,120,0.12)' : C.surfaceHigh, border: `1px solid ${isSkipped ? C.orange : C.border}`, borderRadius: 8, padding: '10px 0', color: isSkipped ? C.orange : C.textMid, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', marginBottom: 24 }}
        >
          {isSkipped ? '↩ Unskip this occurrence' : '⊘ Skip this occurrence'}
        </button>

        {!showDelete ? (
          <button onClick={() => setShowDelete(true)} style={{ background: 'none', border: 'none', color: C.red, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', display: 'block', margin: '0 auto' }}>
            Delete this transaction…
          </button>
        ) : (
          <div style={{ background: C.redBg, border: `1px solid ${C.red}`, borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 13, color: C.red, fontWeight: 600, marginBottom: 8 }}>Delete "{tx.label}" and all its history?</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{ ...S.btn(C.red), flex: 1 }} onClick={deleteTx} disabled={saving}>
                {saving ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button style={{ ...S.btn(C.surfaceHigh, true) }} onClick={() => setShowDelete(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── OVERVIEW TAB (NOW) ────────────────────────────────────────────────────────
function OverviewTab({ accounts, transactions, overrides, onReconcile, bookId, onGoToCycles, onGoToAccounts }) {
  const today = todayStr()
  const [envelopes, setEnvelopes] = useState([])

  useEffect(() => {
    async function loadEnvelopes() {
      const { data: cycles } = await supabase
        .from('pay_cycles')
        .select('id')
        .eq('book_id', bookId)
        .lte('start_date', today)
        .gte('end_date', today)
        .limit(1)
      if (!cycles?.length) return
      const { data: envs } = await supabase
        .from('cycle_envelopes')
        .select('*')
        .eq('cycle_id', cycles[0].id)
      setEnvelopes(envs || [])
    }
    if (bookId) loadEnvelopes()
  }, [bookId, today])

  const totalCash = accounts
    .filter(a => a.type !== 'credit' && !a.track_only)
    .reduce((s, a) => s + (parseFloat(a.balance) || 0), 0)

  const end14 = new Date(); end14.setDate(end14.getDate() + 14)
  const end14str = end14.toISOString().slice(0, 10)

  // Find next income date within 14 days
  const nextIncomeDate = useMemo(() => {
    const dates = []
    for (const tx of transactions.filter(t => t.type === 'income')) {
      dates.push(...expandTx(tx, today, end14str))
    }
    dates.sort()
    return dates[0] || null
  }, [transactions, today, end14str])

  // Bills strictly before next income (or all 14d if no income coming)
  const billsUntilNext = useMemo(() => {
    const cutoff = nextIncomeDate || end14str
    const items = []
    for (const tx of transactions.filter(t => t.type === 'expense')) {
      const dates = expandTx(tx, today, cutoff)
      for (const d of dates) {
        if (nextIncomeDate && d >= nextIncomeDate) continue
        const ov = getOverride(overrides, tx.id, d)
        if (ov?.action === 'skipped') continue
        const amt = ov?.action === 'modified' ? (parseFloat(ov.modified_amount) || 0) : (parseFloat(tx.amount) || 0)
        items.push({ tx, date: d, amt })
      }
    }
    return items.sort((a, b) => a.date.localeCompare(b.date))
  }, [transactions, overrides, today, nextIncomeDate, end14str])

  const billsTotal = billsUntilNext.reduce((s, i) => s + i.amt, 0)
  const safeToSpend = totalCash - billsTotal

  // 14-day calendar grid
  const calendarDays = useMemo(() => {
    const WDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() + i)
      const ds = d.toISOString().slice(0, 10)
      let net = 0
      for (const tx of transactions) {
        if (!expandTx(tx, ds, ds).length) continue
        const ov = getOverride(overrides, tx.id, ds)
        if (ov?.action === 'skipped') continue
        const amt = ov?.action === 'modified' ? (parseFloat(ov.modified_amount) || 0) : (parseFloat(tx.amount) || 0)
        net += tx.type === 'income' ? amt : -amt
      }
      return { ds, day: d.getDate(), wday: WDAYS[d.getDay()], net, isToday: i === 0, isPayday: ds === nextIncomeDate }
    })
  }, [transactions, overrides, nextIncomeDate])

  // Envelopes at ≥90% usage
  const lowEnvelopes = useMemo(() =>
    envelopes.filter(env => {
      const allocated = parseFloat(env.allocated_amount) || 0
      if (allocated <= 0) return false
      return (parseFloat(env.spent_amount) || 0) / allocated >= 0.9
    }),
  [envelopes])

  return (
    <div>
      {/* Safe to spend hero */}
      <div style={{ background: safeToSpend >= 0 ? C.greenBg : C.redBg, borderRadius: 14, padding: '18px 16px', marginBottom: 12, border: `1px solid ${safeToSpend >= 0 ? C.green : C.red}` }}>
        <div style={{ fontSize: 10, color: safeToSpend >= 0 ? C.green : C.red, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>
          Safe to spend{nextIncomeDate ? ` · til ${fmtDateLabel(nextIncomeDate)}` : ' · 14d outlook'}
        </div>
        <div style={{ fontSize: 36, fontWeight: 700, color: safeToSpend >= 0 ? C.green : C.red, letterSpacing: -1 }}>{fmtAmt(safeToSpend)}</div>
        <div style={{ fontSize: 11, color: safeToSpend >= 0 ? C.green : C.red, marginTop: 4, display: 'flex', gap: 16 }}>
          <span>{fmtAmt(totalCash)} cash</span>
          {billsTotal > 0 && <span>− {fmtAmt(billsTotal)} bills</span>}
        </div>
      </div>

      {/* Accounts */}
      <div style={S.card}>
        <div style={{ ...S.lbl, marginBottom: 8 }}>Accounts</div>
        {accounts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '12px 0 4px' }}>
            <div style={{ fontSize: 12, color: C.textLow, marginBottom: 10 }}>No accounts yet</div>
            <button onClick={onGoToAccounts} style={{ ...S.btn(), fontSize: 12, padding: '8px 16px' }}>Add your first account →</button>
          </div>
        )}
        {accounts.map((a, i) => (
          <div key={a.id} onClick={() => onReconcile(a)} style={{ ...S.row, cursor: 'pointer', borderBottom: i < accounts.length - 1 ? `1px solid ${C.border}` : 'none' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{a.name}</div>
              <div style={{ fontSize: 10, color: a.track_only ? C.orange : C.textLow }}>
                {a.type}{a.track_only ? ' · tracking only' : ''}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: (parseFloat(a.balance) || 0) >= 0 ? C.green : C.red }}>{fmt(a.balance) || '--'}</div>
              <span style={{ fontSize: 10, color: C.purple }}>↺</span>
            </div>
          </div>
        ))}
      </div>

      {/* Today's activity */}
      {(() => {
        const todayItems = transactions.flatMap(tx => {
          if (!expandTx(tx, today, today).length) return []
          const ov = getOverride(overrides, tx.id, today)
          if (ov?.action === 'skipped') return []
          const amt = ov?.action === 'modified' ? (parseFloat(ov.modified_amount) || 0) : (parseFloat(tx.amount) || 0)
          return [{ tx, amt, approved: ov?.action === 'approved' }]
        })
        return todayItems.length > 0 && (
          <div style={S.card}>
            <div style={{ ...S.lbl, marginBottom: 8 }}>Today</div>
            {todayItems.map(({ tx, amt, approved }, i) => (
              <div key={tx.id} style={{ ...S.row, borderBottom: i < todayItems.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: approved ? 700 : 500 }}>{tx.label}</div>
                  <div style={{ fontSize: 10, color: C.textLow }}>{tx.account}</div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: tx.type === 'income' ? C.green : C.red }}>
                  {tx.type === 'income' ? '+' : '−'}{fmt(amt)}
                </div>
              </div>
            ))}
          </div>
        )
      })()}

      {/* 14-day calendar grid */}
      <div style={S.card}>
        <div style={{ ...S.lbl, marginBottom: 10 }}>Next 14 days</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
          {calendarDays.map(({ ds, day, wday, net, isToday, isPayday }) => (
            <div key={ds} style={{ background: isToday ? C.surfaceHigh : 'transparent', borderRadius: 7, padding: '5px 3px', border: isToday ? `1px solid ${C.purple}` : isPayday ? `1px solid ${C.green}` : `1px solid ${C.border}`, textAlign: 'center', minHeight: 52 }}>
              <div style={{ fontSize: 8, color: isToday ? C.purple : isPayday ? C.green : C.textLow }}>{wday}</div>
              <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 400, color: isToday ? C.purple : isPayday ? C.green : C.textMid }}>{day}</div>
              {net !== 0 && (
                <div style={{ fontSize: 8, fontWeight: 700, color: net > 0 ? C.green : C.red, lineHeight: 1.3, marginTop: 2 }}>
                  {net > 0 ? '+' : ''}{fmtAmt(net)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Bills til next payday */}
      {billsUntilNext.length > 0 && (
        <div style={S.card}>
          <div style={{ ...S.lbl, marginBottom: 8 }}>Bills til {nextIncomeDate ? fmtDateLabel(nextIncomeDate) : 'next income'}</div>
          {billsUntilNext.map((item, i) => (
            <div key={`${item.tx.id}:${item.date}`} style={{ ...S.row, borderBottom: i < billsUntilNext.length - 1 ? `1px solid ${C.border}` : 'none' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{item.tx.label}</div>
                <div style={{ fontSize: 10, color: C.textLow }}>{fmtDateLabel(item.date)} · {item.tx.account}</div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.red }}>−{fmt(item.amt)}</div>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 12, color: C.textLow }}>Total: <span style={{ color: C.red, fontWeight: 700 }}>{fmt(billsTotal)}</span></span>
          </div>
        </div>
      )}

      {/* Tight envelopes (≥90% used) */}
      {lowEnvelopes.length > 0 && (
        <div style={S.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={S.lbl}>Tight envelopes</div>
            <button onClick={onGoToCycles} style={{ background: 'none', border: 'none', color: C.purple, fontSize: 11, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>Go to Cycles →</button>
          </div>
          {lowEnvelopes.map(env => {
            const allocated = parseFloat(env.allocated_amount) || 0
            const spent = parseFloat(env.spent_amount) || 0
            const remaining = allocated - spent
            const pct = Math.min(100, (spent / allocated) * 100)
            const isOver = spent > allocated
            return (
              <div key={env.id} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {env.color && <div style={{ width: 8, height: 8, borderRadius: '50%', background: env.color, flexShrink: 0 }} />}
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{env.name}</span>
                  </div>
                  <span style={{ fontSize: 11, color: isOver ? C.red : C.orange }}>
                    {isOver ? `Over ${fmt(Math.abs(remaining))}` : `${fmt(remaining)} left`}
                  </span>
                </div>
                <div style={{ height: 5, background: C.surfaceHigh, borderRadius: 3, overflow: 'hidden', marginBottom: 5 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: isOver ? C.red : C.orange, borderRadius: 3 }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: C.textLow }}>{Math.round(pct)}% used</span>
                  <button onClick={onGoToCycles} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 8px', color: C.textMid, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Reassign →
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── AHEAD TAB (UPCOMING TIMELINE) ────────────────────────────────────────────
function AheadTab({ accounts, transactions, overrides, onOverrideChange, bookId, categories, onEditTx }) {
  const today = todayStr()
  const end30 = new Date(); end30.setDate(end30.getDate() + 30)
  const endStr = end30.toISOString().slice(0, 10)

  const [cycle, setCycle] = useState(null)
  const [editSheet, setEditSheet] = useState(null) // { tx, date, override }

  useEffect(() => {
    supabase.from('pay_cycles').select('*').eq('book_id', bookId)
      .lte('start_date', today).gte('end_date', today).limit(1)
      .then(({ data }) => setCycle(data?.[0] || null))
  }, [bookId, today])

  const totalCash = accounts.filter(a => a.type !== 'credit' && !a.track_only)
    .reduce((s, a) => s + (parseFloat(a.balance) || 0), 0)

  const upcoming = useMemo(() => {
    const items = []
    for (const tx of transactions) {
      for (const d of expandTx(tx, today, endStr)) {
        const ov = getOverride(overrides, tx.id, d)
        items.push({ tx, date: d, override: ov, state: ov?.action || 'projected' })
      }
    }
    return items.sort((a, b) => a.date.localeCompare(b.date))
  }, [transactions, overrides, today, endStr])

  const upcomingWithBal = useMemo(() => {
    let bal = totalCash
    return upcoming.map(inst => {
      const amt = inst.state === 'modified'
        ? (parseFloat(inst.override?.modified_amount) || 0)
        : (parseFloat(inst.tx.amount) || 0)
      if (inst.state !== 'skipped') bal += inst.tx.type === 'income' ? amt : -amt
      return { ...inst, balAfter: bal, amt }
    })
  }, [upcoming, totalCash])

  const byDate = useMemo(() => {
    const map = new Map()
    for (const inst of upcomingWithBal) {
      if (!map.has(inst.date)) map.set(inst.date, [])
      map.get(inst.date).push(inst)
    }
    return Array.from(map.entries())
  }, [upcomingWithBal])

  const lowBalDates = useMemo(() =>
    new Set(upcomingWithBal.filter(i => i.balAfter < 200).map(i => i.date)),
  [upcomingWithBal])

  async function quickApprove(tx, date, state) {
    const newAction = state === 'approved' ? null : 'approved'
    const ov = getOverride(overrides, tx.id, date)
    if (newAction === null && ov) await supabase.from('cashflow_overrides').delete().eq('id', ov.id)
    else {
      const rec = { transaction_id: tx.id, instance_date: date, action: newAction }
      if (ov) await supabase.from('cashflow_overrides').update(rec).eq('id', ov.id)
      else await supabase.from('cashflow_overrides').insert(rec)
    }
    onOverrideChange()
  }

  async function quickSkip(tx, date, state) {
    const newAction = state === 'skipped' ? null : 'skipped'
    const ov = getOverride(overrides, tx.id, date)
    if (newAction === null && ov) await supabase.from('cashflow_overrides').delete().eq('id', ov.id)
    else {
      const rec = { transaction_id: tx.id, instance_date: date, action: newAction }
      if (ov) await supabase.from('cashflow_overrides').update(rec).eq('id', ov.id)
      else await supabase.from('cashflow_overrides').insert(rec)
    }
    onOverrideChange()
  }

  return (
    <div>
      {/* Pay cycle countdown */}
      {cycle && (() => {
        const end = new Date(cycle.end_date + 'T00:00:00')
        const now = new Date(); now.setHours(0, 0, 0, 0)
        const daysLeft = Math.max(0, Math.round((end - now) / 86400000) + 1)
        const start = new Date(cycle.start_date + 'T00:00:00')
        const total = Math.round((end - start) / 86400000) + 1
        const pct = Math.min(100, ((total - daysLeft) / total) * 100)
        return (
          <div style={{ ...S.card, background: C.surfaceHigh, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: C.textLow, textTransform: 'uppercase', letterSpacing: 2 }}>Pay cycle</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>
                  {new Date(cycle.start_date + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                  {' – '}
                  {new Date(cycle.end_date + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: daysLeft <= 3 ? C.orange : C.text, lineHeight: 1 }}>{daysLeft}</div>
                <div style={{ fontSize: 10, color: C.textLow }}>days left</div>
              </div>
            </div>
            <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: C.purple, borderRadius: 2 }} />
            </div>
          </div>
        )
      })()}

      {/* Timeline */}
      {byDate.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: C.textLow, fontSize: 13 }}>
          No upcoming transactions in the next 30 days.<br />
          <span style={{ fontSize: 11 }}>Use the + button to add income or bills.</span>
        </div>
      )}
      {byDate.map(([date, insts]) => {
        const isToday = date === today
        const endBal = insts[insts.length - 1]?.balAfter
        const isLow = lowBalDates.has(date)
        return (
          <div key={date}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 2, padding: '12px 0 5px', fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: isToday ? C.purple : C.textMid }}>
              <span>{isToday ? '● TODAY' : fmtDateLabel(date)}</span>
              {endBal != null && (
                <span style={{ fontSize: 11, fontWeight: 700, color: isLow ? C.orange : endBal >= 0 ? C.green : C.red }}>
                  {isLow && '⚠ '}{fmtAmt(endBal)}
                </span>
              )}
            </div>
            {insts.map((inst, i) => {
              const isIncome = inst.tx.type === 'income'
              const isApproved = inst.state === 'approved'
              const isSkipped = inst.state === 'skipped'
              const isPast = date < today
              return (
                <div key={`${inst.tx.id}:${inst.date}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: i < insts.length - 1 ? `1px solid ${C.border}` : 'none', opacity: isSkipped ? 0.4 : 1 }}>
                  <button
                    onClick={() => quickApprove(inst.tx, inst.date, inst.state)}
                    style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${isApproved ? C.green : isPast ? 'var(--c-warn-50)' : C.border}`, background: isApproved ? C.green : 'transparent', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}
                  >
                    {isApproved && <span style={{ color: 'var(--c-btn-text)', fontWeight: 900 }}>✓</span>}
                  </button>
                  <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setEditSheet({ tx: inst.tx, date: inst.date, override: inst.override })}>
                    <div style={{ fontSize: 13, fontWeight: isApproved ? 700 : 500, fontStyle: inst.state === 'projected' ? 'italic' : 'normal', color: isSkipped ? C.textLow : C.text, textDecoration: isSkipped ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {inst.tx.label}
                    </div>
                    <div style={{ fontSize: 10, color: C.textLow }}>{inst.tx.account}{inst.tx.recurrence !== 'once' ? ` · ↻ ${inst.tx.recurrence}` : ''}</div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: isIncome ? C.green : C.red, flexShrink: 0 }}>
                    {isIncome ? '+' : '−'}{fmt(inst.amt)}
                  </div>
                  <button onClick={() => quickSkip(inst.tx, inst.date, inst.state)} style={{ background: 'none', border: 'none', color: isSkipped ? C.orange : C.textLow, cursor: 'pointer', fontSize: 13, padding: '0 2px', flexShrink: 0 }}>
                    {isSkipped ? '↩' : '⊘'}
                  </button>
                </div>
              )
            })}
          </div>
        )
      })}

      {editSheet && (
        <EditTxSheet
          tx={editSheet.tx} date={editSheet.date} override={editSheet.override}
          categories={categories}
          onClose={() => setEditSheet(null)}
          onRefresh={onOverrideChange}
        />
      )}
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
    .filter(a => a.type !== 'credit' && !a.track_only)
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
                <div style={{ fontSize: 9, color: bal >= 0 ? 'var(--c-positive-67)' : 'var(--c-negative-67)', marginTop: 2 }}>
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
function AccountsTab({ accounts, bookId, onReconcile, onRefresh, initAdd, onInitAddDone }) {
  const [editId, setEditId] = useState(null)
  const [editName, setEditName] = useState('')
  const [saving, setSaving] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('checking')
  const [newBalance, setNewBalance] = useState('')
  const [addErr, setAddErr] = useState(null)

  useEffect(() => {
    if (initAdd) { setShowAdd(true); onInitAddDone?.() }
  }, [initAdd])

  async function saveEdit(id) {
    setSaving(true)
    await supabase.from('cashflow_accounts').update({ name: editName }).eq('id', id)
    setSaving(false)
    setEditId(null)
    onRefresh()
  }

  async function toggleTrackOnly(account) {
    await supabase.from('cashflow_accounts').update({ track_only: !account.track_only }).eq('id', account.id)
    onRefresh()
  }

  async function addAccount() {
    if (!newName.trim()) { setAddErr('Enter an account name'); return }
    setSaving(true); setAddErr(null)
    const signedBalance = newType === 'credit'
      ? -(Math.abs(parseFloat(newBalance) || 0))
      : (parseFloat(newBalance) || 0)
    const { error } = await supabase.from('cashflow_accounts').insert({
      book_id: bookId, name: newName.trim(), type: newType,
      balance: signedBalance,
      baseline_date: todayStr(),
    })
    setSaving(false)
    if (error) { setAddErr(error.message); return }
    setShowAdd(false); setNewName(''); setNewBalance(''); setNewType('checking')
    onRefresh()
  }

  return (
    <div>
      <div style={{ fontSize: 11, color: C.textLow, marginBottom: 14 }}>
        Tap a balance to reconcile it against your actual bank balance.
      </div>
      {accounts.length === 0 && !showAdd && (
        <div style={{ textAlign: 'center', padding: '32px 0 16px', color: C.textLow, fontSize: 13 }}>
          No accounts yet. Add one to get started.
        </div>
      )}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              {a.baseline_date
                ? <div style={{ fontSize: 10, color: C.textLow }}>Last confirmed: {fmtMonthDay(a.baseline_date)}</div>
                : <div />
              }
              <button
                onClick={() => toggleTrackOnly(a)}
                style={{ background: 'none', border: `1px solid ${a.track_only ? C.orange : C.border}`, borderRadius: 10, padding: '3px 10px', color: a.track_only ? C.orange : C.textLow, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
              >
                {a.track_only ? '○ Tracking only' : '● In balance'}
              </button>
            </div>
          </div>
        )
      })}

      {showAdd ? (
        <div style={S.card}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>New Account</div>
          <div style={{ marginBottom: 10 }}>
            <div style={S.lbl}>Name</div>
            <input style={S.inp} placeholder="e.g. Chequing" value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <div style={S.lbl}>Type</div>
              <select style={S.sel} value={newType} onChange={e => setNewType(e.target.value)}>
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
                <option value="credit">Credit</option>
              </select>
            </div>
            <div>
              <div style={S.lbl}>Current Balance</div>
              <input style={S.inp} type="number" inputMode="decimal" placeholder={newType === 'credit' ? 'Amount owed' : '0.00'} value={newBalance} onChange={e => setNewBalance(e.target.value)} />
              {newType === 'credit' && (
                <div style={{ fontSize: 10, color: C.orange, marginTop: 3 }}>Stored as negative (debt)</div>
              )}
            </div>
          </div>
          {addErr && <div style={{ color: C.red, fontSize: 12, marginBottom: 10 }}>{addErr}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...S.btn(C.green), flex: 1 }} onClick={addAccount} disabled={saving}>
              {saving ? 'Saving…' : 'Add Account'}
            </button>
            <button style={{ ...S.btn(C.surfaceHigh, true) }} onClick={() => { setShowAdd(false); setAddErr(null) }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button style={{ ...S.btn(), width: '100%', marginTop: 4 }} onClick={() => setShowAdd(true)}>
          + Add Account
        </button>
      )}
    </div>
  )
}

// ─── TRANSACTIONS TAB (FULL HISTORY) ─────────────────────────────────────────
function TransactionsTab({ accounts, transactions, overrides, bookId, onRefresh, categories }) {
  const today = todayStr()
  const past90 = new Date(); past90.setDate(past90.getDate() - 90)
  const future30 = new Date(); future30.setDate(future30.getDate() + 30)
  const startStr = past90.toISOString().slice(0, 10)
  const endStr = future30.toISOString().slice(0, 10)

  const [filterType, setFilterType] = useState('')
  const [filterAccount, setFilterAccount] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [sortBy, setSortBy] = useState('date') // 'date' | 'amount'
  const [editSheet, setEditSheet] = useState(null)

  const catOptions = categories?.length ? categories : DEFAULT_CATEGORIES.map(n => ({ name: n }))

  const instances = useMemo(() => {
    const items = []
    for (const tx of transactions) {
      if (filterType && tx.type !== filterType) continue
      if (filterAccount && tx.account !== filterAccount) continue
      if (filterCategory && tx.category !== filterCategory) continue
      for (const d of expandTx(tx, startStr, endStr)) {
        const ov = getOverride(overrides, tx.id, d)
        const amt = ov?.action === 'modified'
          ? (parseFloat(ov.modified_amount) || 0)
          : (parseFloat(tx.amount) || 0)
        items.push({ tx, date: d, override: ov, state: ov?.action || 'projected', amt })
      }
    }
    if (sortBy === 'amount') return items.sort((a, b) => b.amt - a.amt)
    return items.sort((a, b) => b.date.localeCompare(a.date))
  }, [transactions, overrides, filterType, filterAccount, filterCategory, sortBy, startStr, endStr])

  return (
    <div>
      {/* Filter row */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, overflowX: 'auto', paddingBottom: 2 }}>
        {[['', 'All'], ['income', 'Income'], ['expense', 'Bills']].map(([v, label]) => (
          <button key={v} onClick={() => setFilterType(v)}
            style={{ flexShrink: 0, background: filterType === v ? C.purple : C.surfaceHigh, border: 'none', borderRadius: 20, padding: '6px 14px', color: filterType === v ? 'var(--c-btn-text)' : C.textMid, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: filterType === v ? 700 : 400 }}>
            {label}
          </button>
        ))}
        <select style={{ ...S.sel, flexShrink: 0, minWidth: 100, fontSize: 12, padding: '5px 10px' }} value={filterAccount} onChange={e => setFilterAccount(e.target.value)}>
          <option value="">All accounts</option>
          {accounts.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
        </select>
        <select style={{ ...S.sel, flexShrink: 0, minWidth: 110, fontSize: 12, padding: '5px 10px' }} value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
          <option value="">All categories</option>
          {catOptions.map((c, i) => <option key={i} value={c.name}>{c.name}</option>)}
        </select>
      </div>

      {/* Sort row */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: C.textLow, textTransform: 'uppercase', letterSpacing: 1.5 }}>Sort</span>
        {[['date', 'Date'], ['amount', 'Amount']].map(([v, label]) => (
          <button key={v} onClick={() => setSortBy(v)}
            style={{ background: sortBy === v ? C.surfaceHigh : 'none', border: `1px solid ${sortBy === v ? C.purple : C.border}`, borderRadius: 6, padding: '4px 10px', color: sortBy === v ? C.purple : C.textLow, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
            {label}
          </button>
        ))}
      </div>

      {instances.length === 0 && (
        <div style={{ textAlign: 'center', color: C.textLow, padding: '40px 0', fontSize: 13 }}>
          No transactions match these filters
        </div>
      )}

      {instances.map((inst, i) => {
        const isIncome = inst.tx.type === 'income'
        const isSkipped = inst.state === 'skipped'
        const isApproved = inst.state === 'approved'
        const isPast = inst.date < today
        return (
          <div key={`${inst.tx.id}:${inst.date}`}
            onClick={() => setEditSheet({ tx: inst.tx, date: inst.date, override: inst.override })}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: i < instances.length - 1 ? `1px solid ${C.border}` : 'none', cursor: 'pointer', opacity: isSkipped ? 0.45 : 1 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: isApproved ? C.green : inst.state === 'projected' ? (isPast ? C.orange : C.border) : C.green, flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, textDecoration: isSkipped ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {inst.tx.label}
              </div>
              <div style={{ fontSize: 10, color: C.textLow, marginTop: 1 }}>
                {fmtDateLabel(inst.date)}{inst.tx.account ? ` · ${inst.tx.account}` : ''}{inst.tx.category ? ` · ${inst.tx.category}` : ''}
                {inst.tx.recurrence !== 'once' && <span style={{ color: 'var(--c-info-67)' }}> · ↻</span>}
              </div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: isIncome ? C.green : C.red, flexShrink: 0 }}>
              {isIncome ? '+' : '−'}{fmt(inst.amt)}
            </div>
          </div>
        )
      })}

      {editSheet && (
        <EditTxSheet
          tx={editSheet.tx} date={editSheet.date} override={editSheet.override}
          categories={categories}
          onClose={() => setEditSheet(null)}
          onRefresh={onRefresh}
        />
      )}
    </div>
  )
}

// ─── CHECK-IN BANNER ──────────────────────────────────────────────────────────
function CheckInBanner({ onReconcile, onQuickAdd, onDismiss }) {
  return (
    <div style={{ background: 'var(--c-warn-bg)', border: `1px solid var(--c-warn-border)`, borderRadius: 12, padding: '12px 14px', marginBottom: 14 }}>
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

// ─── SHARE SHEET ─────────────────────────────────────────────────────────────
function ShareSheet({ book, session, onClose }) {
  const [members, setMembers] = useState([])
  const [invites, setInvites] = useState([])
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)
  const isOwner = book.owner_user_id === session.user.id

  async function load() {
    const [{ data: m }, { data: inv }] = await Promise.all([
      supabase.from('book_members').select('*').eq('book_id', book.id),
      supabase.from('book_invites').select('*').eq('book_id', book.id).eq('status', 'pending'),
    ])
    setMembers(m || [])
    setInvites(inv || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [book.id])

  async function sendInvite() {
    const e = email.trim().toLowerCase()
    if (!e || !e.includes('@')) { setErr('Enter a valid email'); return }
    if (e === session.user.email) { setErr("That's your own email"); return }
    setSaving(true); setErr(null); setMsg(null)
    const { error } = await supabase.from('book_invites').upsert(
      { book_id: book.id, email: e, invited_by: session.user.id, status: 'pending' },
      { onConflict: 'book_id,email' }
    )
    setSaving(false)
    if (error) { setErr(error.message); return }
    setEmail('')
    setMsg(`Invite sent to ${e}. They'll see it when they next open the app.`)
    load()
  }

  async function cancelInvite(id) {
    await supabase.from('book_invites').delete().eq('id', id)
    load()
  }

  async function removeMember(userId) {
    if (!window.confirm('Remove this co-owner from the book?')) return
    await supabase.from('book_members').delete().eq('book_id', book.id).eq('user_id', userId)
    load()
  }

  const shS = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 1000, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }
  const shI = { background: C.surface, borderRadius: '20px 20px 0 0', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }

  return (
    <div style={shS} onClick={onClose}>
      <div style={shI} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '18px 18px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Share Book</div>
            <div style={{ fontSize: 11, color: C.textLow, marginTop: 2 }}>{book.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textLow, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: '16px 18px', overflowY: 'auto' }}>
          {loading ? <div style={{ color: C.textLow, fontSize: 13 }}>Loading…</div> : (
            <>
              {/* Current members */}
              <div style={S.secHead()}>Members</div>
              <div style={{ ...S.card, padding: '4px 14px' }}>
                <div style={{ ...S.row, borderBottom: `1px solid ${C.border}` }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{session.user.email}</div>
                    <div style={{ fontSize: 10, color: C.purple, marginTop: 2 }}>Owner</div>
                  </div>
                </div>
                {members.map(m => (
                  <div key={m.id} style={{ ...S.row, borderBottom: 'none' }}>
                    <div>
                      <div style={{ fontSize: 13 }}>{m.email}</div>
                      <div style={{ fontSize: 10, color: C.textLow, marginTop: 2 }}>Co-owner</div>
                    </div>
                    {isOwner && (
                      <button onClick={() => removeMember(m.user_id)}
                        style={{ background: 'none', border: 'none', color: C.red, fontSize: 12, cursor: 'pointer', padding: '4px 8px' }}>
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                {members.length === 0 && (
                  <div style={{ fontSize: 12, color: C.textLow, padding: '10px 0' }}>No co-owners yet</div>
                )}
              </div>

              {/* Pending invites */}
              {invites.length > 0 && (
                <>
                  <div style={S.secHead(C.orange)}>Pending Invites</div>
                  <div style={{ ...S.card, padding: '4px 14px' }}>
                    {invites.map((inv, i) => (
                      <div key={inv.id} style={{ ...S.row, borderBottom: i < invites.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                        <div style={{ fontSize: 13, color: C.textMid }}>{inv.email}</div>
                        {isOwner && (
                          <button onClick={() => cancelInvite(inv.id)}
                            style={{ background: 'none', border: 'none', color: C.textLow, fontSize: 12, cursor: 'pointer', padding: '4px 8px' }}>
                            Cancel
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Invite form */}
              {isOwner && (
                <>
                  <div style={S.secHead()}>Invite Co-Owner</div>
                  <div style={{ marginBottom: 10 }}>
                    <input style={S.inp} type="email" placeholder="their@email.com"
                      value={email} onChange={e => setEmail(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && sendInvite()} />
                  </div>
                  {err && <div style={{ color: C.red, fontSize: 12, marginBottom: 10 }}>{err}</div>}
                  {msg && <div style={{ color: C.green, fontSize: 12, marginBottom: 10 }}>{msg}</div>}
                  <button onClick={sendInvite} disabled={saving} style={{ ...S.btn(), width: '100%', opacity: saving ? 0.6 : 1 }}>
                    {saving ? 'Sending…' : 'Send Invite'}
                  </button>
                  <div style={{ fontSize: 10, color: C.textLow, marginTop: 8, textAlign: 'center' }}>
                    The person must already have a Lighthouse Trail account.
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── NOTIFICATION SHEET ───────────────────────────────────────────────────────
const sheetStyle = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 1000, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }
const sheetInner = { background: C.surface, borderRadius: '20px 20px 0 0', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }
const sheetHeader = { padding: '18px 18px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

function NotificationSheet({ session, bookId, onClose }) {
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied')
  const [subscribed, setSubscribed] = useState(false)
  const [settings, setSettings] = useState({ bill_reminders: true, low_balance_alerts: true, low_balance_threshold: '200', notify_hour_utc: '9' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const supported = typeof Notification !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window

  useEffect(() => {
    async function load() {
      try {
        const { data: s } = await supabase.from('notification_settings').select('*').eq('book_id', bookId).maybeSingle()
        if (s) setSettings({ bill_reminders: s.bill_reminders, low_balance_alerts: s.low_balance_alerts, low_balance_threshold: String(s.low_balance_threshold), notify_hour_utc: String(s.notify_hour_utc) })
        if (supported && Notification.permission === 'granted') {
          const swReady = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((_, reject) => setTimeout(() => reject(new Error('sw timeout')), 3000)),
          ])
          const sub = await swReady.pushManager.getSubscription()
          if (sub) {
            const { data } = await supabase.from('push_subscriptions').select('id').eq('endpoint', sub.endpoint).maybeSingle()
            setSubscribed(!!data)
          }
        }
      } catch (_) {
        // SW not ready or settings failed — show UI anyway
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [bookId])

  function swReady() {
    return Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker not ready. Try reloading the app.')), 5000)),
    ])
  }

  async function handleEnable() {
    setErr(null)
    const perm = await Notification.requestPermission()
    setPermission(perm)
    if (perm !== 'granted') { setErr('Notification permission denied'); return }
    const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
    if (!vapidKey) { setErr('VAPID key not configured (set VITE_VAPID_PUBLIC_KEY)'); return }
    setSaving(true)
    try {
      const reg = await swReady()
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) })
      const { endpoint, keys: { p256dh, auth } } = sub.toJSON()
      const { error } = await supabase.from('push_subscriptions').upsert(
        { user_id: session.user.id, book_id: bookId, endpoint, p256dh, auth_key: auth },
        { onConflict: 'endpoint' }
      )
      if (error) throw new Error(error.message)
      setSubscribed(true)
    } catch (e) {
      setErr(e.message)
    }
    setSaving(false)
  }

  async function handleDisable() {
    setSaving(true)
    try {
      const reg = await swReady()
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        await sub.unsubscribe()
      }
    } catch (_) {}
    setSubscribed(false)
    setSaving(false)
  }

  async function handleSaveSettings() {
    setSaving(true)
    setErr(null)
    const threshold = parseFloat(settings.low_balance_threshold)
    const hour = parseInt(settings.notify_hour_utc)
    if (isNaN(threshold) || threshold < 0) { setErr('Enter a valid threshold'); setSaving(false); return }
    if (isNaN(hour) || hour < 0 || hour > 23) { setErr('Enter an hour between 0 and 23'); setSaving(false); return }
    const { error } = await supabase.from('notification_settings').upsert(
      { book_id: bookId, bill_reminders: settings.bill_reminders, low_balance_alerts: settings.low_balance_alerts, low_balance_threshold: threshold, notify_hour_utc: hour },
      { onConflict: 'book_id' }
    )
    if (error) setErr(error.message)
    setSaving(false)
  }

  return (
    <div style={sheetStyle} onClick={onClose}>
      <div style={sheetInner} onClick={e => e.stopPropagation()}>
        <div style={sheetHeader}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Notifications</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textLow, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: '16px 18px', overflowY: 'auto' }}>
          {!supported ? (
            <div style={{ color: C.textMid, fontSize: 13 }}>Push notifications are not supported in this browser.</div>
          ) : loading ? (
            <div style={{ color: C.textLow, fontSize: 13 }}>Loading…</div>
          ) : (
            <>
              {/* Enable / disable */}
              <div style={{ ...S.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{subscribed ? '🔔 Notifications on' : '🔕 Notifications off'}</div>
                  <div style={{ fontSize: 11, color: C.textLow, marginTop: 2 }}>
                    {subscribed ? 'This device will receive alerts' : 'Enable to get bill & balance alerts'}
                  </div>
                </div>
                {subscribed
                  ? <button onClick={handleDisable} disabled={saving} style={{ ...S.btn(C.surfaceHigh, true), padding: '8px 14px', fontSize: 12 }}>Turn off</button>
                  : <button onClick={handleEnable} disabled={saving || permission === 'denied'} style={{ ...S.btn(), padding: '8px 14px', fontSize: 12, opacity: permission === 'denied' ? 0.5 : 1 }}>
                      {permission === 'denied' ? 'Blocked' : saving ? 'Enabling…' : 'Enable'}
                    </button>
                }
              </div>
              {permission === 'denied' && (
                <div style={{ fontSize: 11, color: C.orange, marginTop: -8, marginBottom: 12 }}>
                  Notifications are blocked in your browser settings. Allow them and try again.
                </div>
              )}

              {/* Settings */}
              <div style={S.secHead()}>Alert Settings</div>

              <div style={{ ...S.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Bill reminders</div>
                  <div style={{ fontSize: 11, color: C.textLow }}>Alert when a bill is due tomorrow</div>
                </div>
                <button onClick={() => setSettings(p => ({ ...p, bill_reminders: !p.bill_reminders }))}
                  style={{ background: settings.bill_reminders ? C.purple : C.surfaceHigh, border: 'none', borderRadius: 12, width: 44, height: 24, cursor: 'pointer', transition: 'background 0.2s' }} />
              </div>

              <div style={{ ...S.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Low balance alerts</div>
                  <div style={{ fontSize: 11, color: C.textLow }}>Alert when account balance drops below threshold</div>
                </div>
                <button onClick={() => setSettings(p => ({ ...p, low_balance_alerts: !p.low_balance_alerts }))}
                  style={{ background: settings.low_balance_alerts ? C.purple : C.surfaceHigh, border: 'none', borderRadius: 12, width: 44, height: 24, cursor: 'pointer', transition: 'background 0.2s' }} />
              </div>

              {settings.low_balance_alerts && (
                <div style={{ marginBottom: 14 }}>
                  <div style={S.lbl}>Low balance threshold (CAD)</div>
                  <input style={S.inp} type="number" inputMode="decimal" placeholder="200"
                    value={settings.low_balance_threshold} onChange={e => setSettings(p => ({ ...p, low_balance_threshold: e.target.value }))} />
                </div>
              )}

              <div style={{ marginBottom: 20 }}>
                <div style={S.lbl}>Send notifications at (UTC hour, 0–23)</div>
                <input style={S.inp} type="number" inputMode="numeric" placeholder="9" min="0" max="23"
                  value={settings.notify_hour_utc} onChange={e => setSettings(p => ({ ...p, notify_hour_utc: e.target.value }))} />
                <div style={{ fontSize: 10, color: C.textLow, marginTop: 4 }}>
                  e.g. 9 = 9:00 AM UTC · 14 = 10:00 AM EST · 16 = 12:00 PM EST
                </div>
              </div>

              {err && <div style={{ color: C.red, fontSize: 12, marginBottom: 12 }}>{err}</div>}
              <button onClick={handleSaveSettings} disabled={saving} style={{ ...S.btn(), width: '100%', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving…' : 'Save Settings'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── THEME PICKER ─────────────────────────────────────────────────────────────
const PALETTES = [
  { id: 'amethyst', label: 'Amethyst', swatches: ['#1d0a30','#c9a0e0','#79aea3','#c97c73','#f3c178'] },
  { id: 'sage',     label: 'Sage',     swatches: ['#101e14','#7ab899','#6bad85','#c9826e','#e8c87a'] },
  { id: 'cobalt',   label: 'Cobalt',   swatches: ['#0d1628','#6a9fd4','#76b4cc','#c97c6e','#f0c870'] },
]
const A11Y_OPTIONS = [
  { id: 'none',          label: 'None' },
  { id: 'high-contrast', label: 'High Contrast' },
  { id: 'color-blind',   label: 'Color-Blind' },
]

function parseTheme(id) {
  if (!id || id === 'dark')    return { palette: 'amethyst', mode: 'dark',  a11y: 'none' }
  if (id === 'light')          return { palette: 'amethyst', mode: 'light', a11y: 'none' }
  if (id === 'high-contrast')  return { palette: 'amethyst', mode: 'dark',  a11y: 'high-contrast' }
  if (id === 'color-blind')    return { palette: 'amethyst', mode: 'dark',  a11y: 'color-blind' }
  const [m, p] = id.split('-') // e.g. 'dark-sage', 'light-cobalt'
  return { palette: p || 'amethyst', mode: m || 'dark', a11y: 'none' }
}

function buildThemeId(palette, mode, a11y) {
  if (a11y !== 'none') return a11y
  if (palette === 'amethyst') return mode
  return `${mode}-${palette}`
}

function ModeCard({ id, selected, palette, onClick }) {
  const isDark = id === 'dark'
  const bg      = isDark ? '#0d0814' : '#faf5ef'
  const surface = isDark ? '#160e21' : '#ffffff'
  const accent  = isDark ? '#c9a0e0' : '#42033d'
  const pos     = isDark ? '#79aea3' : '#004346'
  const neg     = isDark ? '#c97c73' : '#9a4e47'
  const headerBg = isDark ? '#1d0a30' : '#42033d'
  return (
    <button onClick={onClick} style={{ flex: 1, background: bg, border: `2px solid ${selected ? accent : 'transparent'}`, borderRadius: 12, padding: '10px 8px', cursor: 'pointer', textAlign: 'left', outline: 'none' }}>
      {/* mini header */}
      <div style={{ background: headerBg, borderRadius: 6, height: 14, marginBottom: 7, display: 'flex', alignItems: 'center', padding: '0 5px', gap: 4 }}>
        <div style={{ width: 4, height: 4, borderRadius: '50%', background: isDark ? 'rgba(240,234,245,0.6)' : 'rgba(255,255,255,0.7)' }} />
        <div style={{ flex: 1, height: 2, background: isDark ? 'rgba(240,234,245,0.25)' : 'rgba(255,255,255,0.35)', borderRadius: 1 }} />
        <div style={{ width: 10, height: 2, background: isDark ? 'rgba(240,234,245,0.25)' : 'rgba(255,255,255,0.35)', borderRadius: 1 }} />
      </div>
      {/* hero card */}
      <div style={{ background: surface, borderRadius: 6, padding: '5px 7px', marginBottom: 5, border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
        <div style={{ fontSize: 6, color: isDark ? 'rgba(240,234,245,0.45)' : 'rgba(26,10,24,0.45)', marginBottom: 2 }}>Safe to spend</div>
        <div style={{ fontSize: 11, fontWeight: 700, color: pos }}>$1,240</div>
      </div>
      {/* two mock rows */}
      {[pos, neg].map((c, i) => (
        <div key={i} style={{ background: surface, borderRadius: 5, padding: '4px 7px', marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
          <div style={{ width: 36, height: 4, background: isDark ? 'rgba(240,234,245,0.12)' : 'rgba(26,10,24,0.10)', borderRadius: 2 }} />
          <div style={{ width: 18, height: 4, background: `${c}66`, borderRadius: 2 }} />
        </div>
      ))}
      <div style={{ textAlign: 'center', fontSize: 11, fontWeight: selected ? 700 : 400, color: selected ? accent : (isDark ? 'rgba(240,234,245,0.45)' : 'rgba(26,10,24,0.45)'), marginTop: 5 }}>
        {selected && '✓ '}{id === 'dark' ? 'Dark' : 'Light'}
      </div>
    </button>
  )
}

function ThemePicker({ current, onChange, onClose }) {
  const p0 = parseTheme(current)
  const [palette, setPalette] = useState(p0.palette)
  const [mode, setMode] = useState(p0.mode)
  const [a11y, setA11y] = useState(p0.a11y)

  function applyNow(p, m, a) {
    const id = buildThemeId(p, m, a)
    document.documentElement.setAttribute('data-theme', id)
    localStorage.setItem('lt_theme', id)
    onChange(id)
  }
  function pickPalette(p) { setPalette(p); applyNow(p, mode, a11y) }
  function pickMode(m)    { setMode(m); setA11y('none'); applyNow(palette, m, 'none') }
  function pickA11y(a)    { setA11y(a); applyNow(palette, mode, a) }

  const modeActive = a11y === 'none'

  return (
    <div style={sheetStyle} onClick={onClose}>
      <div style={{ ...sheetInner, maxHeight: '88vh' }} onClick={e => e.stopPropagation()}>
        <div style={sheetHeader}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Appearance</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textLow, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: '18px 16px 36px', overflowY: 'auto' }}>

          {/* Palette */}
          <div style={{ fontSize: 10, color: C.textLow, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>Palette</div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 26 }}>
            {PALETTES.map(p => {
              const sel = palette === p.id
              return (
                <button key={p.id} onClick={() => pickPalette(p.id)}
                  style={{ flex: 1, background: sel ? `${C.purple}18` : C.surfaceHigh, border: `2px solid ${sel ? C.purple : C.border}`, borderRadius: 12, padding: '10px 6px', cursor: 'pointer', textAlign: 'center' }}>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginBottom: 8 }}>
                    {p.swatches.map((s, i) => (
                      <div key={i} style={{ width: 14, height: 14, borderRadius: '50%', background: s, flexShrink: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }} />
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: sel ? C.purple : C.textMid, fontWeight: sel ? 700 : 400 }}>
                    {sel ? '✓ ' : ''}{p.label}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Mode */}
          <div style={{ fontSize: 10, color: C.textLow, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>Mode</div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 26 }}>
            <ModeCard id="dark"  selected={modeActive && mode === 'dark'}  palette={palette} onClick={() => pickMode('dark')} />
            <ModeCard id="light" selected={modeActive && mode === 'light'} palette={palette} onClick={() => pickMode('light')} />
          </div>

          {/* Accessibility */}
          <div style={{ fontSize: 10, color: C.textLow, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>Accessibility</div>
          <div style={{ display: 'flex', borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.border}` }}>
            {A11Y_OPTIONS.map((a, i) => (
              <button key={a.id} onClick={() => pickA11y(a.id)}
                style={{ flex: 1, background: a11y === a.id ? C.purple : C.surfaceHigh, border: 'none', borderLeft: i > 0 ? `1px solid ${C.border}` : 'none', padding: '11px 4px', color: a11y === a.id ? 'var(--c-btn-text)' : C.textMid, fontFamily: 'inherit', fontSize: 11, cursor: 'pointer', fontWeight: a11y === a.id ? 700 : 400 }}>
                {a.label}
              </button>
            ))}
          </div>

        </div>
      </div>
    </div>
  )
}

// ─── STACK MENU ───────────────────────────────────────────────────────────────
function StackMenu({ activeTab, onNavigate, onShowNotif, onShowShare, onSignOut, onClose }) {
  const navItems = [
    { id: 'cycles',   icon: '⊙', label: 'Cycles',   desc: 'Plan spending with budget envelopes per pay period' },
    { id: 'goals',    icon: '◈', label: 'Goals',    desc: 'Named savings targets with progress tracking' },
    { id: 'accounts', icon: '◎', label: 'Accounts', desc: 'Manage accounts and reconcile balances' },
  ]
  return (
    <div style={sheetStyle} onClick={onClose}>
      <div style={{ ...sheetInner, maxHeight: '80vh' }} onClick={e => e.stopPropagation()}>
        <div style={{ ...sheetHeader }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>More</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textLow, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1 }}>
          {navItems.map(item => (
            <button key={item.id} onClick={() => { onNavigate(item.id); onClose() }}
              style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', background: activeTab === item.id ? C.surfaceHigh : C.surface, border: `1px solid ${activeTab === item.id ? C.purple : C.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 10, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
              <span style={{ fontSize: 22, width: 28, textAlign: 'center', flexShrink: 0 }}>{item.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: activeTab === item.id ? C.purple : C.text }}>{item.label}</div>
                <div style={{ fontSize: 11, color: C.textMid, marginTop: 2 }}>{item.desc}</div>
              </div>
              <span style={{ color: C.textLow, fontSize: 18 }}>›</span>
            </button>
          ))}

          <div style={{ borderTop: `1px solid ${C.border}`, margin: '8px 0 12px' }} />

          {[
            { label: '🔔 Notifications', fn: () => { onShowNotif(); onClose() } },
            { label: '👥 Share Book',     fn: () => { onShowShare(); onClose() } },
          ].map(({ label, fn }) => (
            <button key={label} onClick={fn}
              style={{ display: 'flex', alignItems: 'center', width: '100%', background: 'none', border: 'none', padding: '13px 4px', color: C.text, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', borderBottom: `1px solid ${C.border}` }}>
              {label}
            </button>
          ))}
          <button onClick={onSignOut}
            style={{ display: 'flex', alignItems: 'center', width: '100%', background: 'none', border: 'none', padding: '13px 4px', color: C.red, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', marginBottom: 8 }}>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── HELP SHEET ───────────────────────────────────────────────────────────────
const HELP_ITEMS = [
  { icon: '⌂', title: 'Now',          body: "This is your live financial picture. Safe to Spend tells you what's actually available after committed bills — it's not your bank balance, it's your real number." },
  { icon: '→', title: 'Ahead',        body: "What's coming up in the next 30 days. Bills are shown as they fall due. Tap ✓ to confirm something happened, ⊘ to skip it, or the row to edit the amount." },
  { icon: '≡', title: 'History',      body: "Your full transaction record — past and projected. Filter by type or category. Tap any row to edit the amount or delete the transaction." },
  { icon: '⊙', title: 'Pay Cycles',   body: "Each paycheck is a cycle. You allocate money to envelopes before you spend it. Unspent rolls forward — no resets, no shame." },
  { icon: '□', title: 'Envelopes',    body: "Buckets for variable spending — groceries, fun money, etc. You decide how much goes in each one. When an envelope runs low, you can reassign from another." },
  { icon: '◈', title: 'Goals',        body: "Give a name and a target to something you're saving for. Contribute each cycle. The progress bar moves when you do." },
  { icon: '↺', title: 'Reconcile',    body: "When your app balance drifts from your actual bank balance, reconcile. The app walks you through what happened — you confirm or adjust. This keeps projections accurate." },
  { icon: 'i', title: 'Projected vs Confirmed', body: "Italic = hasn't happened yet. Bold = confirmed. Strikethrough = skipped. The app tracks the difference so you always know what's real vs. what's expected." },
]

function HelpSheet({ onClose }) {
  return (
    <div style={sheetStyle} onClick={onClose}>
      <div style={{ ...sheetInner, maxHeight: '88vh' }} onClick={e => e.stopPropagation()}>
        <div style={{ ...sheetHeader }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>How Lighthouse Trail works</div>
            <div style={{ fontSize: 11, color: C.textLow, marginTop: 2 }}>A calm, honest look at your money</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textLow, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: '12px 18px 32px', overflowY: 'auto', flex: 1 }}>
          {HELP_ITEMS.map(item => (
            <div key={item.title} style={{ display: 'flex', gap: 14, padding: '14px 0', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 20, flexShrink: 0, width: 28, textAlign: 'center', paddingTop: 2, color: C.purple }}>{item.icon}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{item.title}</div>
                <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.65 }}>{item.body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── FLOATING ACTION BUTTON ───────────────────────────────────────────────────
function FAB({ onTransaction, onBill, onGoal }) {
  const [open, setOpen] = useState(false)
  const actions = [
    { label: 'Add Transaction', color: C.purple, fn: onTransaction },
    { label: 'Add Bill',        color: C.orange, fn: onBill },
    { label: 'Save to Goal',    color: C.green,  fn: onGoal },
  ]
  return (
    <>
      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 149 }} onClick={() => setOpen(false)} />
      )}
      <div style={{ position: 'fixed', bottom: 'calc(76px + env(safe-area-inset-bottom))', right: 16, zIndex: 150, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, pointerEvents: 'none' }}>
        {open && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, pointerEvents: 'auto' }}>
            {actions.map(({ label, color, fn }) => (
              <button key={label} onClick={() => { fn(); setOpen(false) }}
                style={{ background: color, border: 'none', borderRadius: 20, padding: '9px 18px', color: 'var(--c-btn-text)', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>
                + {label}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setOpen(v => !v)}
          style={{ width: 52, height: 52, borderRadius: '50%', background: C.purple, border: 'none', color: 'var(--c-btn-text)', fontSize: 26, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.5)', fontFamily: 'inherit', transform: open ? 'rotate(45deg)' : 'none', transition: 'transform 0.15s', pointerEvents: 'auto' }}
        >
          +
        </button>
      </div>
    </>
  )
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
function MainApp({ session, book, allBooks, onSwitchBook, onSignOut }) {
  const [accounts, setAccounts] = useState([])
  const [transactions, setTransactions] = useState([])
  const [overrides, setOverrides] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('now')
  const [reconcileAccount, setReconcileAccount] = useState(null)
  const [showAddTx, setShowAddTx] = useState(false)
  const [showAddBill, setShowAddBill] = useState(false)
  const [showCheckin, setShowCheckin] = useState(false)
  const [showBookPicker, setShowBookPicker] = useState(false)
  const [showNotifSheet, setShowNotifSheet] = useState(false)
  const [showShareSheet, setShowShareSheet] = useState(false)
  const [showAccountPicker, setShowAccountPicker] = useState(false)
  const [showThemePicker, setShowThemePicker] = useState(false)
  const [showStack, setShowStack] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [currentTheme, setCurrentTheme] = useState(() => localStorage.getItem('lt_theme') || 'dark')
  const [newBookName, setNewBookName] = useState('')
  const [creatingBook, setCreatingBook] = useState(false)

  const today = todayStr()

  useEffect(() => {
    const key = 'lt_checkin_' + today
    if (!localStorage.getItem(key)) setShowCheckin(true)
  }, [today])

  const loadData = useCallback(async () => {
    const [{ data: accts }, { data: txs }, { data: cats }] = await Promise.all([
      supabase.from('cashflow_accounts').select('*').eq('book_id', book.id).order('name'),
      supabase.from('cashflow_transactions').select('*').eq('book_id', book.id).order('date'),
      supabase.from('categories').select('*').eq('book_id', book.id).order('sort_order'),
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
    // Seed default categories if none exist
    if (!cats || cats.length === 0) {
      await seedDefaultCategories(book.id)
      const { data: fresh } = await supabase.from('categories').select('*').eq('book_id', book.id).order('sort_order')
      setCategories(fresh || [])
    } else {
      setCategories(cats)
    }
    setLoading(false)
  }, [book.id])

  useEffect(() => { loadData() }, [loadData])

  function dismissCheckin() {
    localStorage.setItem('lt_checkin_' + today, '1')
    setShowCheckin(false)
  }

  async function handleReconcileSave({ newBalance, newBaselineDate, overrides: ovToWrite, newTransactions: newTxs }) {
    const acct = reconcileAccount
    for (const ov of ovToWrite) {
      const existing = overrides.find(o => String(o.transaction_id) === String(ov.transaction_id) && o.instance_date === ov.instance_date)
      if (existing) await supabase.from('cashflow_overrides').update({ action: ov.action, modified_amount: ov.modified_amount }).eq('id', existing.id)
      else await supabase.from('cashflow_overrides').insert(ov)
    }
    for (const nt of newTxs) {
      await supabase.from('cashflow_transactions').insert({
        label: nt.label, amount: parseFloat(nt.amount), type: nt.type,
        account: acct.name, date: nt.date || newBaselineDate, recurrence: 'once', book_id: book.id,
      })
    }
    await supabase.from('cashflow_accounts').update({ balance: newBalance, baseline_date: newBaselineDate }).eq('id', acct.id)
    setReconcileAccount(null)
    dismissCheckin()
    await loadData()
  }

  async function createBook() {
    if (!newBookName.trim()) return
    setCreatingBook(true)
    const { data: bookId, error } = await supabase.rpc('create_personal_book', { p_name: newBookName.trim(), p_migrate: false })
    if (!error) {
      const { data: newBook } = await supabase.from('books').select('*').eq('id', bookId).single()
      if (newBook) { onSwitchBook(newBook) }
    }
    setCreatingBook(false)
    setShowBookPicker(false)
    setNewBookName('')
  }

  const MAIN_TABS = [
    { id: 'now',          label: 'Now',     icon: '⌂' },
    { id: 'ahead',        label: 'Ahead',   icon: '→' },
    { id: 'transactions', label: 'History', icon: '≡' },
  ]
  const isStackActive = ['cycles', 'goals', 'accounts'].includes(activeTab)

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={{ background: 'var(--c-header-grad)', padding: '14px 16px 10px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 10, color: C.textLow, letterSpacing: 3, textTransform: 'uppercase' }}>
              {new Date().toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, letterSpacing: -0.3 }}>Lighthouse Trail</div>
            <button onClick={() => setShowBookPicker(true)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
              <span style={{ fontSize: 10, color: C.textLow }}>{book.name}</span>
              <span style={{ fontSize: 9, color: C.purple }}>▾</span>
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button onClick={() => setShowHelp(true)} title="How it works"
              style={{ background: 'none', border: 'none', color: C.textLow, fontSize: 14, cursor: 'pointer', padding: '4px 7px', lineHeight: 1, fontFamily: 'inherit' }}>
              ⓘ
            </button>
            <button onClick={() => setShowThemePicker(true)} title="Appearance"
              style={{ background: 'none', border: 'none', color: showThemePicker ? C.purple : C.textLow, fontSize: 15, cursor: 'pointer', padding: '4px 7px', lineHeight: 1 }}>
              ◐
            </button>
            <button onClick={() => setShowStack(true)} title="More"
              style={{ background: 'none', border: 'none', color: isStackActive ? C.purple : C.textLow, fontSize: 17, cursor: 'pointer', padding: '4px 7px', lineHeight: 1 }}>
              ☰
            </button>
          </div>
        </div>
      </div>

      {/* Book picker */}
      {showBookPicker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200 }} onClick={() => { setShowBookPicker(false); setNewBookName('') }}>
          <div style={{ position: 'absolute', top: 70, left: 16, right: 16, background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 10, color: C.textLow, letterSpacing: 2, textTransform: 'uppercase', padding: '12px 14px 6px' }}>My Books</div>
            {allBooks.map(b => (
              <button key={b.id} onClick={() => { onSwitchBook(b); setShowBookPicker(false); setNewBookName('') }}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', background: 'none', border: 'none', borderTop: `1px solid ${C.border}`, padding: '13px 14px', color: C.text, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontWeight: b.id === book.id ? 700 : 400 }}>{b.name}</span>
                {b.id === book.id && <span style={{ fontSize: 12, color: C.purple }}>✓</span>}
              </button>
            ))}
            <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px 14px 14px' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...S.inp, flex: 1, fontSize: 13, padding: '8px 10px' }}
                  placeholder="New book name…" value={newBookName}
                  onChange={e => setNewBookName(e.target.value)}
                  onKeyDown={async e => { if (e.key === 'Enter') await createBook() }} />
                <button disabled={creatingBook || !newBookName.trim()} onClick={createBook}
                  style={{ ...S.btn(), padding: '8px 14px', fontSize: 12, opacity: (!newBookName.trim() || creatingBook) ? 0.5 : 1 }}>
                  {creatingBook ? '…' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Body */}
      <div style={{ padding: '14px 16px 0' }}>
        {showCheckin && (
          <CheckInBanner
            onReconcile={() => {
              setShowCheckin(false)
              if (accounts.length === 1) setReconcileAccount(accounts[0])
              else if (accounts.length > 1) setShowAccountPicker(true)
            }}
            onQuickAdd={() => { setShowCheckin(false); setShowAddTx(true) }}
            onDismiss={dismissCheckin}
          />
        )}
        {loading ? <Spinner /> : (
          <>
            {activeTab === 'now' && (
              <OverviewTab accounts={accounts} transactions={transactions} overrides={overrides}
                onReconcile={setReconcileAccount} bookId={book.id}
                onGoToCycles={() => setActiveTab('cycles')}
                onGoToAccounts={() => setActiveTab('accounts')} />
            )}
            {activeTab === 'ahead' && (
              <AheadTab accounts={accounts} transactions={transactions} overrides={overrides}
                onOverrideChange={loadData} bookId={book.id} categories={categories} />
            )}
            {activeTab === 'transactions' && (
              <TransactionsTab accounts={accounts} transactions={transactions} overrides={overrides}
                bookId={book.id} onRefresh={loadData} categories={categories} />
            )}
            {activeTab === 'cycles' && (
              <CyclesTab bookId={book.id} accounts={accounts} transactions={transactions} />
            )}
            {activeTab === 'goals' && (
              <GoalsTab bookId={book.id} />
            )}
            {activeTab === 'accounts' && (
              <AccountsTab accounts={accounts} bookId={book.id} onReconcile={setReconcileAccount}
                onRefresh={loadData} initAdd={false} onInitAddDone={() => {}} />
            )}
          </>
        )}
      </div>

      {/* Bottom tab bar */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: C.surface, borderTop: `1px solid ${C.border}`, display: 'flex', zIndex: 100, paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {MAIN_TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ flex: 1, background: 'none', border: 'none', padding: '9px 0 7px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 17, lineHeight: 1, color: activeTab === t.id ? C.purple : C.textMid }}>{t.icon}</span>
            <span style={{ fontSize: 9, color: activeTab === t.id ? C.purple : C.textLow, fontWeight: activeTab === t.id ? 700 : 400, letterSpacing: 0.3 }}>{t.label}</span>
            {activeTab === t.id && <div style={{ width: 16, height: 2, background: C.purple, borderRadius: 1 }} />}
          </button>
        ))}
      </div>

      {/* FAB */}
      <FAB
        onTransaction={() => setShowAddTx(true)}
        onBill={() => setShowAddBill(true)}
        onGoal={() => setActiveTab('goals')}
      />

      {/* Theme picker */}
      {showThemePicker && (
        <ThemePicker current={currentTheme}
          onChange={setCurrentTheme}
          onClose={() => setShowThemePicker(false)} />
      )}

      {/* Account picker for reconcile */}
      {showAccountPicker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 800 }} onClick={() => setShowAccountPicker(false)}>
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: C.surface, borderRadius: '20px 20px 0 0', padding: '20px 18px 36px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Reconcile which account?</div>
              <button onClick={() => setShowAccountPicker(false)} style={{ background: 'none', border: 'none', color: C.textMid, fontSize: 22, cursor: 'pointer' }}>×</button>
            </div>
            {accounts.map(a => (
              <button key={a.id} onClick={() => { setShowAccountPicker(false); setReconcileAccount(a) }}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 10, padding: '13px 14px', color: C.text, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', marginBottom: 8, textAlign: 'left' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{a.name}</div>
                  {a.type && <div style={{ fontSize: 10, color: C.textLow, marginTop: 2 }}>{a.type}</div>}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: (parseFloat(a.balance) || 0) >= 0 ? C.green : C.red }}>
                  {fmt(a.balance) || '--'}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {reconcileAccount && (
        <ReconcileModal account={reconcileAccount} transactions={transactions} overrides={overrides}
          onSave={handleReconcileSave} onClose={() => setReconcileAccount(null)} />
      )}
      {showAddTx && (
        <AddTxModal bookId={book.id} accounts={accounts} categories={categories}
          onSave={() => { setShowAddTx(false); loadData() }}
          onClose={() => setShowAddTx(false)} />
      )}
      {showAddBill && (
        <AddTxModal bookId={book.id} accounts={accounts} categories={categories}
          defaultType="expense" defaultRecurrence="monthly"
          onSave={() => { setShowAddBill(false); loadData() }}
          onClose={() => setShowAddBill(false)} />
      )}
      {showNotifSheet && (
        <NotificationSheet session={session} bookId={book.id} onClose={() => setShowNotifSheet(false)} />
      )}
      {showShareSheet && (
        <ShareSheet book={book} session={session} onClose={() => setShowShareSheet(false)} />
      )}
      {showStack && (
        <StackMenu activeTab={activeTab}
          onNavigate={t => setActiveTab(t)}
          onShowNotif={() => setShowNotifSheet(true)}
          onShowShare={() => setShowShareSheet(true)}
          onSignOut={onSignOut}
          onClose={() => setShowStack(false)} />
      )}
      {showHelp && <HelpSheet onClose={() => setShowHelp(false)} />}
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
  const [pendingInvites, setPendingInvites] = useState([])

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
    async function loadBooks() {
      // Books owned by this user
      const { data: owned } = await supabase.from('books').select('*').eq('owner_user_id', session.user.id).order('created_at')
      // Books shared with this user
      const { data: memberships } = await supabase.from('book_members').select('book_id').eq('user_id', session.user.id)
      const sharedIds = (memberships || []).map(m => m.book_id)
      let shared = []
      if (sharedIds.length > 0) {
        const { data } = await supabase.from('books').select('*').in('id', sharedIds)
        shared = data || []
      }
      const books = [...(owned || []), ...shared]
      setAllBooks(books)
      if (books.length > 0) setBook(books[0])
      // Check for pending invites to this user's email
      const { data: invites } = await supabase.from('book_invites')
        .select('*, books(name)').eq('email', session.user.email).eq('status', 'pending')
      setPendingInvites(invites || [])
      setCheckingBook(false)
    }
    loadBooks()
  }, [session])

  async function acceptInvite(invite) {
    await supabase.from('book_members').insert({
      book_id: invite.book_id, user_id: session.user.id, role: 'member', email: session.user.email,
    })
    await supabase.from('book_invites').update({ status: 'accepted' }).eq('id', invite.id)
    const { data: newBook } = await supabase.from('books').select('*').eq('id', invite.book_id).single()
    if (newBook) { setAllBooks(prev => [...prev, newBook]); setBook(newBook) }
    setPendingInvites(prev => prev.filter(i => i.id !== invite.id))
  }

  async function declineInvite(invite) {
    await supabase.from('book_invites').update({ status: 'declined' }).eq('id', invite.id)
    setPendingInvites(prev => prev.filter(i => i.id !== invite.id))
  }

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

  if (pendingInvites.length > 0) {
    return (
      <div style={{ ...S.root, paddingBottom: 0, padding: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Lighthouse Trail</div>
        <div style={{ fontSize: 12, color: C.textLow, marginBottom: 20 }}>You have book invitations</div>
        {pendingInvites.map(inv => (
          <div key={inv.id} style={{ ...S.card, borderLeft: `3px solid ${C.purple}` }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              You've been invited to <span style={{ color: C.purple }}>{inv.books?.name || 'a book'}</span>
            </div>
            <div style={{ fontSize: 11, color: C.textLow, marginBottom: 12 }}>
              Accept to become a co-owner and see all data in this book.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => acceptInvite(inv)} style={{ ...S.btn(C.purple), flex: 1 }}>Accept</button>
              <button onClick={() => declineInvite(inv)} style={{ ...S.btn(C.surfaceHigh, true) }}>Decline</button>
            </div>
          </div>
        ))}
        <button onClick={signOut} style={{ ...S.btn(C.surfaceHigh, true), width: '100%', marginTop: 12 }}>Sign out</button>
      </div>
    )
  }

  if (!book) return <BookSetup session={session} onComplete={b => { setAllBooks(prev => [...prev, b]); setBook(b) }} />

  function switchBook(b) {
    if (!allBooks.find(x => x.id === b.id)) setAllBooks(prev => [...prev, b])
    setBook(b)
  }

  return <MainApp session={session} book={book} allBooks={allBooks} onSwitchBook={switchBook} onSignOut={signOut} />
}
