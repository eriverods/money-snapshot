import { describe, it, expect } from 'vitest'
import {
  STARTER_ENVELOPES, buildStarterRows, saveStarterEnvelopes,
} from '../envelopeInbox'
import {
  categoriesForEnvelope, envelopeForCategory, applyEnvelopePick, applyCategoryPick,
} from '../txAssign'

// A minimal Supabase-shaped fake: records inserts + rpcs, returns canned results.
function fakeClient({ insertResult, rpcResult } = {}) {
  const calls = { inserts: [], rpcs: [] }
  return {
    calls,
    from(table) {
      return {
        insert(rows) {
          calls.inserts.push({ table, rows })
          return {
            select() {
              return Promise.resolve(
                insertResult ?? { data: rows.map((_, i) => ({ id: `e${i}` })), error: null }
              )
            },
          }
        },
      }
    },
    rpc(name, args) {
      calls.rpcs.push({ name, args })
      return Promise.resolve(rpcResult ?? { error: null })
    },
  }
}

const starterItems = (over = {}) =>
  STARTER_ENVELOPES.map(s => ({ ...s, on: !s.optional, amount: '', ...over }))

// ─── BUG #1: starter envelopes save (with or without amounts) ─────────────────
describe('buildStarterRows', () => {
  it('always writes a numeric allocation — 0 when amounts are skipped (never null)', () => {
    const rows = buildStarterRows(starterItems(), 'book-1', false)
    expect(rows).toHaveLength(4) // Food, Home, Getting around, Fun (Pets optional/off)
    for (const r of rows) {
      expect(typeof r.allocated_amount).toBe('number')
      expect(r.allocated_amount).toBe(0)
      expect(r.allocated_amount).not.toBeNull()
      expect(r.book_id).toBe('book-1')
      expect(r.spent_amount).toBe(0)
      expect(r.carryover_amount).toBe(0)
    }
  })

  it('parses entered amounts and drops empty-named rows', () => {
    const items = [
      { key: 'food', name: 'Food', emoji: '🍎', color: '#1', on: true, amount: '120.50' },
      { key: 'blank', name: '   ', on: true, amount: '5' },     // empty name → dropped
      { key: 'off', name: 'Pets', on: false, amount: '9' },     // toggled off → dropped
    ]
    const rows = buildStarterRows(items, 'book-1', true)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Food')
    expect(rows[0].allocated_amount).toBe(120.5)
  })
})

describe('saveStarterEnvelopes (integration)', () => {
  it('fresh user → accept starter set with no amounts → envelopes + Whatever catchall provisioned', async () => {
    const client = fakeClient()
    const res = await saveStarterEnvelopes(client, { items: starterItems(), bookId: 'book-1', withAmounts: false })
    expect(res.ok).toBe(true)
    // All chosen envelopes inserted in one batch.
    expect(client.calls.inserts).toHaveLength(1)
    expect(client.calls.inserts[0].table).toBe('envelopes')
    expect(client.calls.inserts[0].rows).toHaveLength(4)
    // The permanent catchall is ensured (is_catchall=true row) for the book.
    expect(client.calls.rpcs).toContainEqual({ name: 'ensure_catchall_envelope', args: { p_book_id: 'book-1' } })
  })

  it('surfaces a hard insert error instead of pretending it worked', async () => {
    const client = fakeClient({ insertResult: { data: null, error: { message: 'permission denied for table envelopes' } } })
    const res = await saveStarterEnvelopes(client, { items: starterItems(), bookId: 'book-1', withAmounts: false, failMsg: 'fallback' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('permission denied for table envelopes')
    // We never claim success, so the catchall rpc is not reached.
    expect(client.calls.rpcs).toHaveLength(0)
  })

  it('treats 0-rows-with-no-error as failure (RLS silently dropped the write)', async () => {
    const client = fakeClient({ insertResult: { data: [], error: null } })
    const res = await saveStarterEnvelopes(client, { items: starterItems(), bookId: 'book-1', withAmounts: false, failMsg: 'fallback' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('fallback')
  })

  it('surfaces a catchall-provisioning failure', async () => {
    const client = fakeClient({ rpcResult: { error: { message: 'rpc boom' } } })
    const res = await saveStarterEnvelopes(client, { items: starterItems(), bookId: 'book-1', withAmounts: false })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('rpc boom')
  })
})

// ─── BUG #2: envelope ↔ category controls never conflict ──────────────────────
describe('txAssign helpers', () => {
  const categories = [
    { id: 'c1', name: 'Groceries', envelope_id: 'food', archived: false },
    { id: 'c2', name: 'Dining', envelope_id: 'food', archived: false },
    { id: 'c3', name: 'Bus', envelope_id: 'getabout', archived: false },
    { id: 'c4', name: 'Old', envelope_id: 'food', archived: true }, // archived → ignored
    { id: 'c5', name: 'Unmapped', envelope_id: null, archived: false },
  ]

  it('filters categories to a single envelope, excluding archived', () => {
    expect(categoriesForEnvelope(categories, 'food').map(c => c.name)).toEqual(['Groceries', 'Dining'])
    expect(categoriesForEnvelope(categories, 'getabout').map(c => c.name)).toEqual(['Bus'])
    expect(categoriesForEnvelope(categories, '')).toEqual([])
  })

  it('auto-selects an envelope’s only category when picking that envelope', () => {
    const next = applyEnvelopePick({ category: '', envelopeId: '' }, 'getabout', categories)
    expect(next).toEqual({ envelopeId: 'getabout', category: 'Bus' })
  })

  it('does not auto-select when an envelope has multiple categories', () => {
    const next = applyEnvelopePick({ category: '', envelopeId: '' }, 'food', categories)
    expect(next).toEqual({ envelopeId: 'food', category: '' })
  })

  it('clears a category that belongs to a different envelope (never conflicting)', () => {
    const next = applyEnvelopePick({ category: 'Bus', envelopeId: 'getabout' }, 'food', categories)
    expect(next.envelopeId).toBe('food')
    expect(next.category).toBe('') // Bus belongs to getabout, so it is dropped
  })

  it('picking a category auto-sets its envelope (single source of truth)', () => {
    const next = applyCategoryPick({ category: '', envelopeId: '' }, 'Groceries', categories)
    expect(next).toEqual({ envelopeId: 'food', category: 'Groceries' })
    // invariant: the resulting pair never disagrees
    expect(envelopeForCategory(categories, next.category)).toBe(next.envelopeId)
  })

  it('an unmapped category leaves the envelope untouched', () => {
    const next = applyCategoryPick({ category: '', envelopeId: 'food' }, 'Unmapped', categories)
    expect(next).toEqual({ envelopeId: 'food', category: 'Unmapped' })
  })
})
