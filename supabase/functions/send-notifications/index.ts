import webpush from "npm:web-push@3.6.7"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
)

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT")!,
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
)

Deno.serve(async () => {
  const currentHour = new Date().getUTCHours()

  // Get all notification settings where notify_hour_utc matches now
  const { data: settings, error: settingsErr } = await supabase
    .from("notification_settings")
    .select("*, books(owner_user_id)")
    .eq("notify_hour_utc", currentHour)

  if (settingsErr) return new Response(settingsErr.message, { status: 500 })
  if (!settings || settings.length === 0) return new Response("No notifications due", { status: 200 })

  const tomorrow = new Date()
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)

  const results: string[] = []

  for (const s of settings) {
    const bookId = s.book_id
    const userId = s.books?.owner_user_id
    if (!userId) continue

    // Get push subscriptions for this user
    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("user_id", userId)
      .eq("book_id", bookId)

    if (!subs || subs.length === 0) continue

    const notifications: Array<{ title: string; body: string }> = []

    // ── Bill reminders ────────────────────────────────────────────────────────
    if (s.bill_reminders) {
      const { data: bills } = await supabase
        .from("cashflow_transactions")
        .select("label, amount, recurrence, date, end_date")
        .eq("book_id", bookId)
        .eq("type", "expense")
        .or(
          // one-time bill due tomorrow
          `and(recurrence.eq.once,date.eq.${tomorrowStr}),` +
          // weekly: same day of week
          `and(recurrence.eq.weekly,date.lte.${tomorrowStr}),` +
          // biweekly
          `and(recurrence.eq.biweekly,date.lte.${tomorrowStr}),` +
          // monthly: same day of month
          `and(recurrence.eq.monthly,date.lte.${tomorrowStr})`
        )

      const tomorrowDate = new Date(tomorrowStr + "T00:00:00Z")

      const dueTomorrow = (bills || []).filter(tx => {
        if (tx.end_date && new Date(tx.end_date + "T00:00:00Z") < tomorrowDate) return false
        const txDate = new Date(tx.date + "T00:00:00Z")
        if (tx.recurrence === "once") return tx.date === tomorrowStr
        if (tx.recurrence === "weekly") {
          return txDate.getUTCDay() === tomorrowDate.getUTCDay()
        }
        if (tx.recurrence === "biweekly") {
          const diffDays = Math.round((tomorrowDate.getTime() - txDate.getTime()) / 86400000)
          return diffDays >= 0 && diffDays % 14 === 0
        }
        if (tx.recurrence === "monthly") {
          return txDate.getUTCDate() === tomorrowDate.getUTCDate()
        }
        return false
      })

      if (dueTomorrow.length > 0) {
        const total = dueTomorrow.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0)
        const fmt = (n: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(n)
        const names = dueTomorrow.map(tx => tx.label).join(", ")
        notifications.push({
          title: `${dueTomorrow.length} bill${dueTomorrow.length > 1 ? "s" : ""} due tomorrow`,
          body: `${names} — ${fmt(total)} total`,
        })
      }
    }

    // ── Low balance alerts ────────────────────────────────────────────────────
    if (s.low_balance_alerts) {
      const threshold = parseFloat(s.low_balance_threshold) || 200
      const { data: accounts } = await supabase
        .from("cashflow_accounts")
        .select("name, balance, type")
        .eq("book_id", bookId)
        .in("type", ["checking", "savings"])
        .lt("balance", threshold)

      for (const acct of accounts || []) {
        const fmt = (n: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(n)
        notifications.push({
          title: `Low balance: ${acct.name}`,
          body: `Balance is ${fmt(acct.balance)}, below your ${fmt(threshold)} threshold`,
        })
      }
    }

    // ── Inbox nudge ───────────────────────────────────────────────────────────
    // At most one gentle nudge every 3 days, only when 5+ transactions are
    // waiting. Never daily, never guilt-toned.
    if (s.inbox_reminders) {
      const lastNudge = s.last_inbox_nudge_at ? new Date(s.last_inbox_nudge_at) : null
      const threeDaysAgo = new Date(Date.now() - 3 * 86400000)
      const eligible = !lastNudge || lastNudge < threeDaysAgo
      if (eligible) {
        const todayStr = new Date().toISOString().slice(0, 10)
        const { count } = await supabase
          .from("cashflow_transactions")
          .select("id", { count: "exact", head: true })
          .eq("book_id", bookId)
          .eq("type", "expense")
          .is("envelope_id", null)
          .lte("date", todayStr)
        if ((count || 0) >= 5) {
          notifications.push({
            title: "A quick sort is waiting",
            body: `${count} transactions are waiting for a quick sort — takes about 30 seconds.`,
          })
          await supabase
            .from("notification_settings")
            .update({ last_inbox_nudge_at: new Date().toISOString() })
            .eq("id", s.id)
        }
      }
    }

    // ── Send ──────────────────────────────────────────────────────────────────
    for (const notif of notifications) {
      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
            JSON.stringify({ title: notif.title, body: notif.body, url: "/" }),
          )
          results.push(`OK: ${sub.endpoint.slice(-20)} — ${notif.title}`)
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          // 410 Gone = subscription expired, remove it
          if (msg.includes("410") || msg.includes("404")) {
            await supabase.from("push_subscriptions").delete().eq("id", sub.id)
            results.push(`REMOVED stale sub: ${sub.endpoint.slice(-20)}`)
          } else {
            results.push(`ERR: ${msg}`)
          }
        }
      }
    }
  }

  return new Response(results.join("\n") || "Nothing to send", { status: 200 })
})
