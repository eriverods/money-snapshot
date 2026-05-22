import { useState, useEffect, useRef } from "react";

const SUPABASE_URL = "https://vrnwuqvaexejngrtxres.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZybnd1cXZhZXhlam5ncnR4cmVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0MTUwODksImV4cCI6MjA5NDk5MTA4OX08DMN3FVx_4VmEYfTDatHIpfZNM8W4laGChhG4gUCmVM";

const ACCOUNTS = [
{ id: "chq1", label: "Bills",        type: "bank",   color: "#4ade80" },
{ id: "chq2", label: "Koho Joint",  type: "bank",   color: "#34d399" },
{ id: "amex", label: "Amex",        type: "credit", color: "#f87171" },
{ id: "cap1", label: "Capital One", type: "credit", color: "#fb923c" },
{ id: "neow", label: "Neo World",   type: "credit", color: "#a78bfa" },
{ id: "neob", label: "Neo (White)", type: "credit", color: "#c4b5fd" },
];

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const CATS = ["Bills","Groceries","Transport","Subscriptions","Dining","Other"];
const RECUR = ["Once","Weekly","Bi-weekly","Monthly","Yearly"];
const INC_SOURCES = ["Employment","Freelance","Government","Investment","Other"];

const DEFAULT_ACCOUNTS = ACCOUNTS.reduce((acc, a) => {acc[a.id] = { balance: "0", dueDay: "", minPayment: "", note: "" };
return acc;
}, {});

// Supabase REST helpers
async function sb(method, table, body, query = "") {
const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
method,
headers: {
"apikey": SUPABASE_KEY,
"Authorization": `Bearer ${SUPABASE_KEY}`,
"Content-Type": "application/json",
"Prefer": method === "POST" ? "resolution=merge-duplicates,return=representation" : "return=representation",
},
body: body ? JSON
.
stringify(body) : undefined,
});
if (!res.ok) {
const err = await res.text();
throw new Error(`Supabase ${method} ${table}: ${err}`);
}
const text = await res.text();
return text ? JSON.parse(text) : null;
}

const dbGet  = (table, query = "")    => sb("GET",    table, null, query);
const dbUpsert = (table, body)        => sb("POST",   table, body);
const dbDelete = (table, query)       => sb("DELETE", table, null, query);

// Load all account balances
async function loadAccounts() {
const rows = await dbGet("money_accounts", "?select=id,data");
const result = { DEFAULT_ACCOUNTS };
(rows || []).forEach(r => { result[r.id] = r.data; });
return result;
}

async function saveAccount(id, data) {
await dbUpsert("money_accounts", { id, data, updated_at: new Date().toISOString() });
}

async function loadExpenses() {
const rows = await dbGet("money_expenses", "?select=id,data&order=id.asc");
return (rows || []).map(r => ({ r.data, id: r.id }));
}

async function saveExpense(expense) {
const { id, …data } = expense;
await dbUpsert("money_expenses", { id, data });
}

async function deleteExpense(id) {
await dbDelete("money_expenses", `?id=eq.${id}`);
}

async function loadIncomes() {
const rows = await dbGet("money_incomes", "?select=id,data&order=id.asc");
return (rows || []).map(r => ({ r.data, id: r.id }));
}

async function saveIncome(income) {
const { id, …data } = income;
await dbUpsert("money_incomes", { id, data });
}

async function deleteIncome(id) {
await dbDelete("money_incomes", `?id=eq.${id}`);
}

async function loadAppliedKeys() {
const rows = await dbGet("money_applied_keys", "?select=key");
return (rows || []).map(r => r.key);
}

async function saveAppliedKey(key) {
await dbUpsert("money_applied_keys", { key });
}

function fmt(val) {
if (val === "" || val == null) return "";
const n = parseFloat(val);
if (isNaN(n)) return "";
return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(n);
}

function getDaysUntil(dayOfMonth) {
if (!dayOfMonth) return null;
const t = new Date();
const d = new Date(t.getFullYear(), t.getMonth(), dayOfMonth);
if (d <= t) d.setMonth(d.getMonth() + 1);
return Math.ceil((d - t) / 864e5);
}

function getDaysUntilDate(ds) {
if (!ds) return null;
const t = new Date(); t.setHours(0,0,0,0);
return Math.ceil((new Date(ds + "T00:00:00") - t) / 864e5);
}

function getOccurrences(item, ws, we) {
const start = new Date(item.date + "T00:00:00");
const out = [];
if (!item.recurrence || item.recurrence === "Once") {
if (start >= ws && start <= we) out.push({ item, occDate: item.date });
return out;
}
let cur = new Date(start), n = 0;
while (cur <= we && n++ < 200) {
if (cur >= ws) out.push({ …item, occDate: cur.toISOString().slice(0,10) });
if (item.recurrence === "Weekly")         cur.setDate(cur.getDate() + 7);
else if (item.recurrence === "Bi-weekly") cur.setDate(cur.getDate() + 14);
else if (item.recurrence === "Monthly")   cur.setMonth(cur.getMonth() + 1);
else if (item.recurrence === "Yearly")    cur.setFullYear(cur.getFullYear() + 1);
else break;
}
return out;
}

function UrgencyBadge({ days }) {
if (days === null) return <span style={{ color:"#6b7280", fontSize:11 }}>Set due date</span>;
if (days < 0)   return <span style={{ background:"#7f1d1d", color:"#fca5a5", borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:700 }}>Overdue</span>;
if (days === 0) return <span style={{ background:"#ef4444", color:"#fff",    borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:700 }}>Due today!</span>;
if (days <= 3)  return <span style={{ background:"#ef4444", color:"#fff",    borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:700 }}>Due in {days}d</span>;
if (days <= 7)  return <span style={{ background:"#f97316", color:"#fff",    borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:700 }}>Due in {days}d</span>;
return <span style={{ background:"#1e293b", color:"#94a3b8", borderRadius:6, padding:"2px 8px", fontSize:11 }}>Due in {days}d</span>;
}

function RecurBadge({ r }) {
if (!r || r === "Once") return null;
return <span style={{ fontSize:9, background:"#0ea5e922", color:"#38bdf8", borderRadius:4, padding:"2px 6px", letterSpacing:1, textTransform:"uppercase", marginLeft:4 }}>↻ {r}</span>;
}

function AccountBadge({ accountId }) {
const acct = ACCOUNTS.find(a => a.id === accountId);
if (!acct) return null;
return <span style={{ fontSize:9, background:acct.color+"22", color:acct.color, borderRadius:4, padding:"2px 6px", letterSpacing:1, textTransform:"uppercase", marginLeft:4 }}>{acct.label}</span>;
}

function ConfirmModal({ items, onConfirm, onDismiss }) {
return (
<div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
<div style={{ background:"#111827", borderRadius:16, border:"1px solid #f97316", padding:20, maxWidth:360, width:"100%" }}>
<div style={{ fontSize:14, fontWeight:700, color:"#f97316", marginBottom:4 }}>Confirm balance update</div>
<div style={{ fontSize:11, color:"#94a3b8", marginBottom:14 }}>These items are due today or have passed. Confirm to apply them to their accounts.</div>
{items.map((item, i) => {
const acct = ACCOUNTS.find(a => a.id === item.accountId);
return (
<div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px solid #1e293b", fontSize:13 }}>
<div>
<div style={{ fontWeight:600 }}>{item.label}</div>
<div style={{ fontSize:10, color:acct?acct.color:"#64748b" }}>{acct?acct.label:"No account"} · {item.occDate} · {item.kind}</div>
</div>
<span style={{ color:item.kind==="income"?"#4ade80":"#f87171", fontWeight:700 }}>{item.kind==="income"?"+":"-"}{fmt(item.amount)}</span>
</div>
);
})}
<div style={{ display:"flex", gap:8, marginTop:16 }}>
<button style={{ flex:1, background:"#f97316", border:"none", borderRadius:8, padding:"10px 0", color:"#0a0f1a", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }} onClick={onConfirm}>Apply to balances</button>
<button style={{ flex:1, background:"#1e293b", border:"none", borderRadius:8, padding:"10px 0", color:"#94a3b8", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }} onClick={onDismiss}>Not yet</button>
</div>
</div>
</div>
);
}

export default function App() {
const today    = new Date();
const todayStr = today.toISOString().slice(0,10);

const [ready, setReady]           = useState(false);
const [dbError, setDbError]       = useState(null);
const [accounts, setAccounts]     = useState(DEFAULT_ACCOUNTS);
const [expenses, setExpenses]     = useState([]);
const [incomes, setIncomes]       = useState([]);
const [appliedKeys, setAppliedKeys] = useState([]);
const [pendingItems, setPendingItems] = useState([]);
const [activeTab, setActiveTab]   = useState("snapshot");
const [showAddExp, setShowAddExp] = useState(false);
const [showAddInc, setShowAddInc] = useState(false);
const [saveStatus, setSaveStatus] = useState("");

const [newExp, setNewExp] = useState({ label:"", amount:"", category:"Bills", date:todayStr, recurrence:"Once", accountId:"" });
const [newInc, setNewInc] = useState({ label:"", amount:"", date:todayStr, recurrence:"Once", source:"Employment", accountId:"" });

// Load everything from Supabase on mount
useEffect(() => {
(async () => {
try {
const [accts, exps, incs, keys] = await Promise.all([
loadAccounts(),
loadExpenses(),
loadIncomes(),
loadAppliedKeys(),
]);
setAccounts(accts);
setExpenses(exps);
setIncomes(incs);
setAppliedKeys(keys);
setReady(true);
} catch(e) {
setDbError(e.message);
setReady(true);
}
})();
}, []);

// Check for due items after load
useEffect(() => {
if (!ready || expenses.length === 0 && incomes.length === 0) return;
const ws = new Date("2000-01-01");
const we = new Date(todayStr + "T23:59:59");
const due = [
…expenses.flatMap(e => {
if (!e.accountId) return [];
return getOccurrences(e, ws, we)
.filter(o => !appliedKeys.includes(`exp:${e.id}:${o.occDate}`))
.map(o => ({ …o, kind:"expense" }));
}),
…incomes.flatMap(i => {
if (!i.accountId) return [];
return getOccurrences(i, ws, we)
.filter(o => !appliedKeys.includes(`inc:${i.id}:${o.occDate}`))
.map(o => ({ …o, kind:"income" }));
}),
];
if (due.length > 0) setPendingItems(due);
}, [ready]);

const flash = () => { setSaveStatus("saved"); setTimeout(() => setSaveStatus(""), 1800); };

async function updateAccountField(id, field, val) {
const updated = { …accounts[id], [field]: val };
setAccounts(prev => ({ …prev, [id]: updated }));
try { await saveAccount(id, updated); flash(); } catch(e) { setDbError(e.message); }
}

async function applyPendingItems() {
const newAccounts = { …accounts };
const newKeys = […appliedKeys];

```
for (const item of pendingItems) {
  const prefix = item.kind === "expense" ? "exp" : "inc";
  const key = `${prefix}:${item.id}:${item.occDate}`;
  if (newKeys.includes(key)) continue;
  newKeys.push(key);

  const acct = ACCOUNTS.find(a => a.id === item.accountId);
  if (!acct) continue;

  const current = parseFloat(newAccounts[item.accountId]?.balance) || 0;
  const amt     = parseFloat(item.amount) || 0;
  let newBal;

  if (item.kind === "expense") {
    // expense: bank = deduct, credit = add to what you owe
    newBal = acct.type === "bank" ? current - amt : current + amt;
  } else {
    // income: bank = add, credit = reduce what you owe
    newBal = acct.type === "bank" ? current + amt : current - amt;
  }

  newAccounts[item.accountId] = { ...newAccounts[item.accountId], balance: String(newBal.toFixed(2)) };
}

setAccounts(newAccounts);
setAppliedKeys(newKeys);
setPendingItems([]);

// Persist to Supabase
try {
  await Promise.all([
    ...Object.entries(newAccounts).map(([id, data]) => saveAccount(id, data)),
    ...newKeys.filter(k => !appliedKeys.includes(k)).map(k => saveAppliedKey(k)),
  ]);
  flash();
} catch(e) { setDbError(e.message); }
```

}

async function addExpense() {
if (!newExp.label || !newExp.amount) return;
const exp = { …newExp, id: Date.now() };
setExpenses(prev => […prev, exp]);
setNewExp({ label:"", amount:"", category:"Bills", date:todayStr, recurrence:"Once", accountId:"" });
setShowAddExp(false);
try { await saveExpense(exp); flash(); } catch(e) { setDbError(e.message); }
}

async function removeExpense(id) {
setExpenses(prev => prev.filter(x => x.id !== id));
try { await deleteExpense(id); flash(); } catch(e) { setDbError(e.message); }
}

async function addIncome() {
if (!newInc.label || !newInc.amount) return;
const inc = { …newInc, id: Date.now() };
setIncomes(prev => […prev, inc]);
setNewInc({ label:"", amount:"", date:todayStr, recurrence:"Once", source:"Employment", accountId:"" });
setShowAddInc(false);
try { await saveIncome(inc); flash(); } catch(e) { setDbError(e.message); }
}

async function removeIncome(id) {
setIncomes(prev => prev.filter(x => x.id !== id));
try { await deleteIncome(id); flash(); } catch(e) { setDbError(e.message); }
}

// Derived totals
const ws30 = new Date(today); ws30.setHours(0,0,0,0);
const we30 = new Date(today); we30.setDate(we30.getDate() + 30);

const totalCash   = ACCOUNTS.filter(a=>a.type==="bank").reduce((s,a) => s + (parseFloat(accounts[a.id]?.balance)||0), 0);
const totalDebt   = ACCOUNTS.filter(a=>a.type==="credit").reduce((s,a) => s + (parseFloat(accounts[a.id]?.balance)||0), 0);
const totalMinPay = ACCOUNTS.filter(a=>a.type==="credit").reduce((s,a) => s + (parseFloat(accounts[a.id]?.minPayment)||0), 0);
const totalExp30  = expenses.flatMap(e=>getOccurrences(e,ws30,we30)).reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
const totalInc30  = incomes.flatMap(i=>getOccurrences(i,ws30,we30)).reduce((s,i)=>s+(parseFloat(i.amount)||0),0);
const netPos      = totalCash + totalInc30 - totalMinPay - totalExp30;

const creditsSorted = ACCOUNTS.filter(a=>a.type==="credit").map(a => {
const dd = parseInt(accounts[a.id]?.dueDay);
return { …a, days: isNaN(dd) ? null : getDaysUntil(dd) };
}).sort((a,b) => a.days===null?1:b.days===null?-1:a.days-b.days);

const up14end = new Date(today); up14end.setDate(up14end.getDate()+14);
const upcoming = [
…expenses.flatMap(e=>getOccurrences(e,ws30,up14end).map(o=>({…o,kind:"expense"}))),
…incomes.flatMap(i=>getOccurrences(i,ws30,up14end).map(o=>({…o,kind:"income"}))),
].sort((a,b)=>new Date(a.occDate)-new Date(b.occDate));

const s = {
root:     { fontFamily:"‘DM Mono’,‘Courier New’,monospace", background:"#0a0f1a", minHeight:"100vh", color:"#e2e8f0", paddingBottom:60 },
header:   { background:"linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%)", padding:"22px 18px 14px", borderBottom:"1px solid #1e293b" },
tabs:     { display:"flex", gap:2, padding:"10px 14px 0", background:"#0a0f1a", borderBottom:"1px solid #1e293b", overflowX:"auto" },
tab:   a  => ({ whiteSpace:"nowrap", padding:"8px 13px", borderRadius:"8px 8px 0 0", border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:11, fontWeight:600, letterSpacing:1, textTransform:"uppercase", background:a?"#1e293b":"transparent", color:a?"#a78bfa":"#475569", borderBottom:a?"2px solid #a78bfa":"2px solid transparent" }),
body:     { padding:"16px 14px" },
card:     { background:"#111827", borderRadius:14, padding:"14px", marginBottom:12, border:"1px solid #1e293b" },
lbl:      { fontSize:10, color:"#64748b", textTransform:"uppercase", letterSpacing:2, marginBottom:4 },
bigNum: c => ({ fontSize:24, fontWeight:700, color:c||"#f1f5f9", letterSpacing:-1 }),
inp:      { background:"#0f172a", border:"1px solid #1e293b", borderRadius:8, padding:"8px 10px", color:"#f1f5f9", fontSize:13, fontFamily:"inherit", width:"100%", boxSizing:"border-box", outline:"none" },
sel:      { background:"#0f172a", border:"1px solid #1e293b", borderRadius:8, padding:"8px 10px", color:"#f1f5f9", fontSize:13, fontFamily:"inherit", width:"100%", boxSizing:"border-box" },
acctCard:c=> ({ background:"#111827", borderRadius:12, padding:"14px", marginBottom:10, borderLeft:`3px solid ${c}` }),
g2:       { display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 },
g3:       { display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 },
netCard: p=> ({ background:p?"linear-gradient(135deg,#064e3b,#065f46)":"linear-gradient(135deg,#450a0a,#7f1d1d)", borderRadius:14, padding:"18px 14px", marginBottom:12, border:`1px solid ${p?"#059669":"#dc2626"}` }),
btn:    c => ({ background:c||"#a78bfa", border:"none", borderRadius:8, padding:"9px 16px", color:"#0a0f1a", fontFamily:"inherit", fontSize:12, fontWeight:700, cursor:"pointer", letterSpacing:0.5 }),
row:      { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:"1px solid #1e293b" },
rmBtn:    { background:"none", border:"none", color:"#ef4444", cursor:"pointer", fontSize:18, padding:"0 2px", lineHeight:1 },
secHead:c=> ({ fontSize:10, color:c, letterSpacing:3, textTransform:"uppercase", margin:"16px 0 8px", fontWeight:700 }),
addForm:  { background:"#111827", borderRadius:14, padding:"14px", border:"1px solid #a78bfa44", marginBottom:14 },
catBadge: cat => { const c={Bills:"#f59e0b",Groceries:"#4ade80",Transport:"#60a5fa",Subscriptions:"#a78bfa",Dining:"#f87171",Other:"#94a3b8"}; return { fontSize:9, background:(c[cat]||"#94a3b8")+"22", color:c[cat]||"#94a3b8", borderRadius:4, padding:"2px 6px", letterSpacing:1, textTransform:"uppercase" }; },
srcBadge: src  => { const c={Employment:"#4ade80",Freelance:"#34d399",Government:"#60a5fa",Investment:"#f59e0b",Other:"#94a3b8"}; return { fontSize:9, background:(c[src]||"#94a3b8")+"22", color:c[src]||"#94a3b8", borderRadius:4, padding:"2px 6px", letterSpacing:1, textTransform:"uppercase" }; },
};

if (!ready) return (
<div style={{ …s.root, display:"flex", alignItems:"center", justifyContent:"center" }}>
<div style={{ color:"#475569", fontSize:13 }}>Connecting to database…</div>
</div>
);

return (
<div style={s.root}>
{pendingItems.length > 0 && (
<ConfirmModal items={pendingItems} onConfirm={applyPendingItems} onDismiss={() => setPendingItems([])} />
)}

```
  <div style={s.header}>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
      <div>
        <div style={{ fontSize:11, color:"#64748b", letterSpacing:3, textTransform:"uppercase", marginBottom:2 }}>
          {MONTHS[today.getMonth()]} {today.getDate()}, {today.getFullYear()}
        </div>
        <div style={{ fontSize:20, fontWeight:700, color:"#f1f5f9", letterSpacing:-0.5 }}>Money Snapshot</div>
        <div style={{ fontSize:10, color:"#475569", marginTop:1 }}>Supabase · 30-day window</div>
      </div>
      <div style={{ textAlign:"right", marginTop:4 }}>
        <div style={{ fontSize:10, color:saveStatus?"#4ade80":"transparent", transition:"color 0.3s" }}>✓ saved to db</div>
        {dbError && <div style={{ fontSize:9, color:"#ef4444", marginTop:2, maxWidth:140 }}>{dbError}</div>}
      </div>
    </div>
  </div>

  <div style={s.tabs}>
    {[["snapshot","Overview"],["accounts","Accounts"],["expenses","Expenses"],["income","Income"]].map(([t,l]) => (
      <button key={t} style={s.tab(activeTab===t)} onClick={() => setActiveTab(t)}>{l}</button>
    ))}
  </div>

  <div style={s.body}>

    {/* OVERVIEW */}
    {activeTab==="snapshot" && (<>
      <div style={s.netCard(netPos>=0)}>
        <div style={{ fontSize:10, color:netPos>=0?"#6ee7b7":"#fca5a5", letterSpacing:3, textTransform:"uppercase", marginBottom:4 }}>Net Position (30 days)</div>
        <div style={{ fontSize:30, fontWeight:700, color:netPos>=0?"#4ade80":"#f87171", letterSpacing:-1 }}>{fmt(netPos)||"--"}</div>
        <div style={{ fontSize:11, color:netPos>=0?"#6ee7b7":"#fca5a5", marginTop:4 }}>{netPos>=0?"You are covered":"Shortfall detected"}</div>
      </div>
      <div style={s.g2}>
        <div style={s.card}><div style={s.lbl}>Cash on Hand</div><div style={s.bigNum("#4ade80")}>{fmt(totalCash)||"--"}</div></div>
        <div style={s.card}><div style={s.lbl}>CC Balances</div><div style={s.bigNum("#f87171")}>{fmt(totalDebt)||"--"}</div></div>
        <div style={s.card}><div style={s.lbl}>Income (30d)</div><div style={s.bigNum("#34d399")}>{fmt(totalInc30)||"--"}</div></div>
        <div style={s.card}><div style={s.lbl}>Expenses (30d)</div><div style={s.bigNum("#fb923c")}>{fmt(totalExp30)||"--"}</div></div>
      </div>

      <div style={s.card}>
        <div style={s.lbl}>Credit Card Payments</div>
        {creditsSorted.map(a => (
          <div key={a.id} style={s.row}>
            <div>
              <span style={{ width:8, height:8, borderRadius:"50%", background:a.color, display:"inline-block", marginRight:8 }}/>
              <span style={{ fontSize:13, fontWeight:600 }}>{a.label}</span>
              {accounts[a.id]?.minPayment && <span style={{ fontSize:11, color:"#64748b", marginLeft:6 }}>min {fmt(accounts[a.id].minPayment)}</span>}
            </div>
            <UrgencyBadge days={a.days} />
          </div>
        ))}
      </div>

      {upcoming.length > 0 && (
        <div style={s.card}>
          <div style={s.lbl}>Next 14 Days</div>
          {upcoming.map((item, i) => {
            const days = getDaysUntilDate(item.occDate);
            const prefix = item.kind==="expense" ? "exp" : "inc";
            const applied = item.accountId && appliedKeys.includes(`${prefix}:${item.id}:${item.occDate}`);
            return (
              <div key={i} style={{ ...s.row, borderBottom:i<upcoming.length-1?"1px solid #1e293b":"none", opacity:applied?0.4:1 }}>
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:4, flexWrap:"wrap" }}>
                    <span style={{ fontSize:13, fontWeight:600, color:item.kind==="income"?"#4ade80":"#f1f5f9" }}>{item.label}</span>
                    {item.recurrence!=="Once" && <RecurBadge r={item.recurrence} />}
                    {item.accountId && <AccountBadge accountId={item.accountId} />}
                    {applied && <span style={{ fontSize:9, color:"#4ade80" }}>✓ applied</span>}
                  </div>
                  <div style={{ fontSize:10, color:"#475569", marginTop:2 }}>{item.occDate}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:14, fontWeight:700, color:item.kind==="income"?"#4ade80":"#f87171" }}>
                    {item.kind==="income"?"+":"-"}{fmt(item.amount)}
                  </div>
                  <div style={{ fontSize:10, color:"#64748b" }}>{days===0?"today":days===1?"tomorrow":`in ${days}d`}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>)}

    {/* ACCOUNTS */}
    {activeTab==="accounts" && (<>
      <div style={{ fontSize:11, color:"#64748b", marginBottom:12 }}>Balances update automatically when income/expenses are confirmed.</div>
      <div style={s.secHead("#4ade80")}>Bank Accounts</div>
      {ACCOUNTS.filter(a=>a.type==="bank").map(a => (
        <div key={a.id} style={s.acctCard(a.color)}>
          <div style={{ fontSize:12, fontWeight:700, letterSpacing:1, textTransform:"uppercase", color:a.color, marginBottom:8 }}>{a.label}</div>
          <div style={s.lbl}>Current Balance</div>
          <input style={s.inp} type="number" placeholder="0.00" value={accounts[a.id]?.balance} onChange={e=>updateAccountField(a.id,"balance",e.target.value)} />
          <div style={{ marginTop:8 }}><div style={s.lbl}>Note</div>
            <input style={s.inp} type="text" placeholder="optional note" value={accounts[a.id]?.note||""} onChange={e=>updateAccountField(a.id,"note",e.target.value)} /></div>
        </div>
      ))}
      <div style={s.secHead("#f87171")}>Credit Cards</div>
      {ACCOUNTS.filter(a=>a.type==="credit").map(a => (
        <div key={a.id} style={s.acctCard(a.color)}>
          <div style={{ fontSize:12, fontWeight:700, letterSpacing:1, textTransform:"uppercase", color:a.color, marginBottom:8 }}>{a.label}</div>
          <div style={s.g3}>
            <div><div style={s.lbl}>Balance Owed</div><input style={s.inp} type="number" placeholder="0.00" value={accounts[a.id]?.balance} onChange={e=>updateAccountField(a.id,"balance",e.target.value)} /></div>
            <div><div style={s.lbl}>Min Payment</div><input style={s.inp} type="number" placeholder="0.00" value={accounts[a.id]?.minPayment||""} onChange={e=>updateAccountField(a.id,"minPayment",e.target.value)} /></div>
            <div><div style={s.lbl}>Due Day</div><input style={s.inp} type="number" placeholder="15" min="1" max="31" value={accounts[a.id]?.dueDay||""} onChange={e=>updateAccountField(a.id,"dueDay",e.target.value)} /></div>
          </div>
          <div style={{ marginTop:8 }}><div style={s.lbl}>Note</div>
            <input style={s.inp} type="text" placeholder="optional note" value={accounts[a.id]?.note||""} onChange={e=>updateAccountField(a.id,"note",e.target.value)} /></div>
        </div>
      ))}
    </>)}

    {/* EXPENSES */}
    {activeTab==="expenses" && (<>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <div style={{ fontSize:11, color:"#64748b" }}>Bills, subscriptions, anything going out</div>
        <button style={s.btn()} onClick={()=>setShowAddExp(!showAddExp)}>{showAddExp?"Cancel":"+ Add"}</button>
      </div>
      {showAddExp && (
        <div style={s.addForm}>
          <div style={s.lbl}>Label</div>
          <input style={{ ...s.inp, marginBottom:8 }} placeholder="e.g. Internet bill" value={newExp.label} onChange={e=>setNewExp(p=>({...p,label:e.target.value}))} />
          <div style={s.g2}>
            <div><div style={s.lbl}>Amount ($)</div><input style={s.inp} type="number" placeholder="0.00" value={newExp.amount} onChange={e=>setNewExp(p=>({...p,amount:e.target.value}))} /></div>
            <div><div style={s.lbl}>Category</div><select style={s.sel} value={newExp.category} onChange={e=>setNewExp(p=>({...p,category:e.target.value}))}>{CATS.map(c=><option key={c}>{c}</option>)}</select></div>
          </div>
          <div style={{ ...s.g2, marginTop:8 }}>
            <div><div style={s.lbl}>Start Date</div><input style={s.inp} type="date" value={newExp.date} onChange={e=>setNewExp(p=>({...p,date:e.target.value}))} /></div>
            <div><div style={s.lbl}>Repeats</div><select style={s.sel} value={newExp.recurrence} onChange={e=>setNewExp(p=>({...p,recurrence:e.target.value}))}>{RECUR.map(r=><option key={r}>{r}</option>)}</select></div>
          </div>
          <div style={{ marginTop:8 }}>
            <div style={s.lbl}>Charge to account</div>
            <select style={s.sel} value={newExp.accountId} onChange={e=>setNewExp(p=>({...p,accountId:e.target.value}))}>
              <option value="">-- No account linked --</option>
              {ACCOUNTS.map(a=><option key={a.id} value={a.id}>{a.label} ({a.type==="bank"?"chequing":"credit"})</option>)}
            </select>
            {newExp.accountId && (
              <div style={{ fontSize:10, color:"#64748b", marginTop:4 }}>
                {ACCOUNTS.find(a=>a.id===newExp.accountId)?.type==="bank" ? "Deducts from chequing when due" : "Adds to card balance when due"}
              </div>
            )}
          </div>
          <button style={{ ...s.btn(), marginTop:12, width:"100%" }} onClick={addExpense}>Add Expense</button>
        </div>
      )}
      {expenses.length===0 && !showAddExp && <div style={{ textAlign:"center", color:"#475569", padding:"40px 0", fontSize:13 }}>No expenses yet. Hit + Add to start.</div>}
      {[...expenses].sort((a,b)=>new Date(a.date)-new Date(b.date)).map((e,i) => (
        <div key={e.id} style={{ ...s.row, borderBottom:i<expenses.length-1?"1px solid #1e293b":"none" }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:3, flexWrap:"wrap" }}>
              <span style={{ fontSize:13, fontWeight:600 }}>{e.label}</span>
              <RecurBadge r={e.recurrence} />
              {e.accountId && <AccountBadge accountId={e.accountId} />}
            </div>
            <div style={{ display:"flex", gap:5, alignItems:"center" }}>
              <span style={s.catBadge(e.category)}>{e.category}</span>
              <span style={{ fontSize:10, color:"#475569" }}>{e.recurrence==="Once"?e.date:`from ${e.date}`}</span>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:14, fontWeight:700, color:"#f87171" }}>{fmt(e.amount)}</span>
            <button style={s.rmBtn} onClick={()=>removeExpense(e.id)}>×</button>
          </div>
        </div>
      ))}
      {expenses.length>0 && (
        <div style={{ ...s.card, marginTop:14, display:"flex", justifyContent:"space-between" }}>
          <span style={{ fontSize:12, color:"#94a3b8" }}>Total out next 30 days</span>
          <span style={{ fontSize:16, fontWeight:700, color:"#f87171" }}>{fmt(totalExp30)}</span>
        </div>
      )}
    </>)}

    {/* INCOME */}
    {activeTab==="income" && (<>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <div style={{ fontSize:11, color:"#64748b" }}>Paycheques, freelance, benefits, anything coming in</div>
        <button style={s.btn("#4ade80")} onClick={()=>setShowAddInc(!showAddInc)}>{showAddInc?"Cancel":"+ Add"}</button>
      </div>
      {showAddInc && (
        <div style={{ ...s.addForm, border:"1px solid #4ade8044" }}>
          <div style={s.lbl}>Label</div>
          <input style={{ ...s.inp, marginBottom:8 }} placeholder="e.g. Paycheque" value={newInc.label} onChange={e=>setNewInc(p=>({...p,label:e.target.value}))} />
          <div style={s.g2}>
            <div><div style={s.lbl}>Amount ($)</div><input style={s.inp} type="number" placeholder="0.00" value={newInc.amount} onChange={e=>setNewInc(p=>({...p,amount:e.target.value}))} /></div>
            <div><div style={s.lbl}>Source</div><select style={s.sel} value={newInc.source} onChange={e=>setNewInc(p=>({...p,source:e.target.value}))}>{INC_SOURCES.map(r=><option key={r}>{r}</option>)}</select></div>
          </div>
          <div style={{ ...s.g2, marginTop:8 }}>
            <div><div style={s.lbl}>Date / First Date</div><input style={s.inp} type="date" value={newInc.date} onChange={e=>setNewInc(p=>({...p,date:e.target.value}))} /></div>
            <div><div style={s.lbl}>Repeats</div><select style={s.sel} value={newInc.recurrence} onChange={e=>setNewInc(p=>({...p,recurrence:e.target.value}))}>{RECUR.map(r=><option key={r}>{r}</option>)}</select></div>
          </div>
          <div style={{ marginTop:8 }}>
            <div style={s.lbl}>Deposit to account</div>
            <select style={s.sel} value={newInc.accountId} onChange={e=>setNewInc(p=>({...p,accountId:e.target.value}))}>
              <option value="">-- No account linked --</option>
              {ACCOUNTS.filter(a=>a.type==="bank").map(a=><option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
            {newInc.accountId && <div style={{ fontSize:10, color:"#64748b", marginTop:4 }}>Adds to chequing balance when date arrives</div>}
          </div>
          <button style={{ ...s.btn("#4ade80"), marginTop:12, width:"100%" }} onClick={addIncome}>Add Income</button>
        </div>
      )}
      {incomes.length===0 && !showAddInc && <div style={{ textAlign:"center", color:"#475569", padding:"40px 0", fontSize:13 }}>No income logged yet. Hit + Add to start.</div>}
      {[...incomes].sort((a,b)=>new Date(a.date)-new Date(b.date)).map((inc,i) => (
        <div key={inc.id} style={{ ...s.row, borderBottom:i<incomes.length-1?"1px solid #1e293b":"none" }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:3 }}>
              <span style={{ fontSize:13, fontWeight:600, color:"#4ade80" }}>{inc.label}</span>
              <RecurBadge r={inc.recurrence} />
              {inc.accountId && <AccountBadge accountId={inc.accountId} />}
            </div>
            <div style={{ display:"flex", gap:5, alignItems:"center" }}>
              <span style={s.srcBadge(inc.source)}>{inc.source}</span>
              <span style={{ fontSize:10, color:"#475569" }}>{inc.recurrence==="Once"?inc.date:`from ${inc.date}`}</span>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:14, fontWeight:700, color:"#4ade80" }}>+{fmt(inc.amount)}</span>
            <button style={s.rmBtn} onClick={()=>removeIncome(inc.id)}>×</button>
          </div>
        </div>
      ))}
      {incomes.length>0 && (
        <div style={{ ...s.card, marginTop:14, display:"flex", justifyContent:"space-between" }}>
          <span style={{ fontSize:12, color:"#94a3b8" }}>Total in next 30 days</span>
          <span style={{ fontSize:16, fontWeight:700, color:"#4ade80" }}>{fmt(totalInc30)}</span>
        </div>
      )}
    </>)}

  </div>
</div>
```

);
}
