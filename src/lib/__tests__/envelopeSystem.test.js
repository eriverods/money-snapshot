import { describe, it, expect } from 'vitest'
import { sanitizeEnvelopeName, graphemeLength, isValidEnvelopeName, ENVELOPE_NAME_MAX } from '../envelopeName'
import {
  suggestEnvelopeId, buildCompostingSuggestion, prettyMerchant,
  normalizeMerchant, STARTER_ENVELOPES,
} from '../envelopeInbox'
import {
  computeUnallocated, envelopeReserved, isCatchall, realEnvelopes, flowThrough,
} from '../envelopeLogic'

// ─── Item 1: emoji envelope names ─────────────────────────────────────────────
describe('sanitizeEnvelopeName', () => {
  it('saves an emoji-named envelope verbatim', () => {
    expect(sanitizeEnvelopeName('🌮 Eating out')).toBe('🌮 Eating out')
    expect(isValidEnvelopeName('🌮 Eating out')).toBe(true)
  })

  it('trims surrounding whitespace only', () => {
    expect(sanitizeEnvelopeName('  Groceries  ')).toBe('Groceries')
  })

  it('preserves accents and non-latin scripts (no character-class filter)', () => {
    expect(sanitizeEnvelopeName('Café & 日本語 💛')).toBe('Café & 日本語 💛')
  })

  it('counts an emoji as one grapheme', () => {
    expect(graphemeLength('🌮')).toBe(1)
    expect(graphemeLength('🌮🌮🌮')).toBe(3)
  })

  it('caps by grapheme count without splitting a cluster', () => {
    const long = '🌮'.repeat(ENVELOPE_NAME_MAX + 10)
    const out = sanitizeEnvelopeName(long)
    expect(graphemeLength(out)).toBeLessThanOrEqual(ENVELOPE_NAME_MAX)
    // never ends mid-surrogate-pair → still all valid tacos
    expect(out).toBe('🌮'.repeat(ENVELOPE_NAME_MAX))
  })

  it('rejects empty / whitespace-only names', () => {
    expect(sanitizeEnvelopeName('   ')).toBe('')
    expect(isValidEnvelopeName('   ')).toBe(false)
  })

  it('does NOT apply merchant normalization to names', () => {
    // normalizeMerchant would strip the "#42" and lowercase; sanitize must not.
    const name = 'Table #42'
    expect(sanitizeEnvelopeName(name)).toBe('Table #42')
    expect(normalizeMerchant(name)).not.toBe(sanitizeEnvelopeName(name))
  })
})

// ─── Item 4: unallocated / safe-to-spend from envelopes ───────────────────────
describe('computeUnallocated', () => {
  const food = { id: 'a', allocated_amount: 100, carryover_amount: 0 }
  const fun = { id: 'b', allocated_amount: 50, carryover_amount: 10 }
  const whatever = { id: 'c', is_catchall: true, allocated_amount: 0 }

  it('subtracts envelope remainders and bills from total cash', () => {
    // reserved: food 100-30=70, fun 60-20=40 → 110; cash 500, bills 100
    const u = computeUnallocated({
      totalCash: 500,
      envelopes: [food, fun, whatever],
      spentByEnv: { a: 30, b: 20 },
      billsTotal: 100,
    })
    expect(u).toBe(500 - 110 - 100)
  })

  it('never lets overspend claw back money (reserve floors at 0)', () => {
    expect(envelopeReserved(food, 250)).toBe(0)
  })

  it('ignores the catchall (it reserves nothing)', () => {
    expect(envelopeReserved(whatever, 999)).toBe(0)
    const u = computeUnallocated({ totalCash: 200, envelopes: [whatever], spentByEnv: { c: 80 }, billsTotal: 0 })
    expect(u).toBe(200)
  })

  it('reactively reflects an assignment moving spend between envelopes', () => {
    const base = computeUnallocated({ totalCash: 300, envelopes: [food, fun], spentByEnv: { a: 0, b: 0 }, billsTotal: 0 })
    const after = computeUnallocated({ totalCash: 300, envelopes: [food, fun], spentByEnv: { a: 40, b: 0 }, billsTotal: 0 })
    // spending in food frees reserved money → unallocated rises by 40
    expect(after - base).toBe(40)
  })
})

// ─── Item 6: the "Whatever" catchall ──────────────────────────────────────────
describe('catchall behaviour', () => {
  const whatever = { id: 'c', is_catchall: true }
  const food = { id: 'a' }

  it('isCatchall / realEnvelopes split correctly', () => {
    expect(isCatchall(whatever)).toBe(true)
    expect(isCatchall(food)).toBe(false)
    expect(realEnvelopes([food, whatever]).map(e => e.id)).toEqual(['a'])
  })

  it('never suggests the catchall from merchant hints', () => {
    const hints = [
      { merchant_normalized: 'tim hortons', envelope_id: 'c', assignment_count: 9 },
    ]
    expect(suggestEnvelopeId('Tim Hortons #123', hints, { excludeIds: ['c'] })).toBe(null)
  })

  it('still suggests a real envelope above the floor', () => {
    const hints = [{ merchant_normalized: 'metro', envelope_id: 'a', assignment_count: 2 }]
    expect(suggestEnvelopeId('METRO #55', hints, { excludeIds: ['c'] })).toBe('a')
  })

  it('composting nudge fires only at the 3rd catchall assignment of one merchant', () => {
    const at2 = [{ merchant_normalized: 'tim hortons', envelope_id: 'c', assignment_count: 2 }]
    expect(buildCompostingSuggestion(at2, [], 'c')).toBe(null)
    const at3 = [{ merchant_normalized: 'tim hortons', envelope_id: 'c', assignment_count: 3 }]
    expect(buildCompostingSuggestion(at3, [], 'c')).toEqual({ merchantNormalized: 'tim hortons', count: 3 })
  })

  it('respects a dismissal forever', () => {
    const hints = [{ merchant_normalized: 'tim hortons', envelope_id: 'c', assignment_count: 9 }]
    const dismissals = [{ merchant_normalized: 'tim hortons' }]
    expect(buildCompostingSuggestion(hints, dismissals, 'c')).toBe(null)
  })

  it('never stacks — returns at most one (the highest-count) merchant', () => {
    const hints = [
      { merchant_normalized: 'tim hortons', envelope_id: 'c', assignment_count: 4 },
      { merchant_normalized: 'esso', envelope_id: 'c', assignment_count: 7 },
    ]
    const s = buildCompostingSuggestion(hints, [], 'c')
    expect(s.merchantNormalized).toBe('esso')
  })

  it('prettyMerchant title-cases a normalized key', () => {
    expect(prettyMerchant('tim hortons')).toBe('Tim Hortons')
  })

  it('flowThrough sums catchall expenses within the cycle window', () => {
    const txs = [
      { envelope_id: 'c', type: 'expense', amount: 5, date: '2026-06-10' },
      { envelope_id: 'c', type: 'expense', amount: 7, date: '2026-06-01' }, // before window
      { envelope_id: 'c', type: 'income', amount: 9, date: '2026-06-11' },  // not an expense
    ]
    const flow = flowThrough({ id: 'c' }, txs, { start: '2026-06-05', end: '2026-06-18' }, '2026-06-12')
    expect(flow).toBe(5)
  })
})

// ─── Item 5: starter set shape ────────────────────────────────────────────────
describe('starter envelopes', () => {
  it('offers Food, Home, Getting around, Fun, and an optional Pets', () => {
    const names = STARTER_ENVELOPES.map(s => s.name)
    expect(names).toEqual(['Food', 'Home', 'Getting around', 'Fun', 'Pets'])
    expect(STARTER_ENVELOPES.find(s => s.key === 'pets').optional).toBe(true)
    // Whatever is the catchall, provisioned separately — never in the editable set.
    expect(names).not.toContain('Whatever')
  })
})
